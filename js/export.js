// export.js – Export als Tabelle (CSV) für Excel, wahlweise nur für einen Zeitraum (z. B. Monatsabschluss).
//
// Tabellen:
//   1) Narkosen: eine Zeile pro Patient, alle Felder – zum Nachschauen und Übertragen ins eLogbuch.
//   2) Zusammenfassung: Zahl pro WBO-Kategorie im Zeitraum, dazu der Gesamtstand.
//   3) Maßnahmen, Intensiv-Fälle, Notarzteinsätze (Schritt 6): je eine eigene Tabelle.
//   4) Nachträge: alle Sammelzahlen.
// Fallnummern gibt es in der App nicht, also stehen auch keine in der Datei.

import { listAnesthesias, listSupplements, getSettings, listAllRecords } from './db.js';
import { COUNTABLE, computeProgress, countProcedures, categoryLabel } from './counting.js';
import { toCsv } from './csv.js';
import { handOverFile } from './share.js';

const rangeChips = document.getElementById('export-range');
const customRange = document.getElementById('export-custom');
const fromInput = document.getElementById('export-from');
const toInput = document.getElementById('export-to');
const rangeInfo = document.getElementById('export-range-info');

// ---------- Zeitraum ----------

function isoDay(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  return `${day}.${month}.${year}`;
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
  'August', 'September', 'Oktober', 'November', 'Dezember'];

// Ermittelt den gewählten Zeitraum: { from, to, label, fileTag }. from/to leer = ohne Grenze.
function selectedRange() {
  const choice = rangeChips.querySelector('input:checked').value;
  const now = new Date();
  if (choice === 'thisMonth' || choice === 'lastMonth') {
    const offset = choice === 'thisMonth' ? 0 : -1;
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0); // Tag 0 = letzter Tag des Vormonats
    return {
      from: isoDay(first),
      to: isoDay(last),
      label: `${MONTHS[first.getMonth()]} ${first.getFullYear()}`,
      fileTag: isoDay(first).slice(0, 7), // z. B. 2026-11
    };
  }
  if (choice === 'custom') {
    const from = fromInput.value;
    const to = toInput.value;
    return {
      from,
      to,
      label: `${from ? formatDate(from) : 'Anfang'} bis ${to ? formatDate(to) : 'heute'}`,
      fileTag: `${from || 'anfang'}_bis_${to || isoDay(now)}`,
    };
  }
  return { from: '', to: '', label: 'alle Einträge', fileTag: `alle_${isoDay(now)}` };
}

function inRange(entry, range) {
  return (!range.from || entry.date >= range.from) && (!range.to || entry.date <= range.to);
}

async function entriesInRange() {
  const range = selectedRange();
  const [all, allRecords] = await Promise.all([listAnesthesias(), listAllRecords()]);
  // Für die Tabelle älteste zuerst (wie in einem Logbuch).
  const entries = all.filter((e) => inRange(e, range)).reverse();
  // Maßnahmen, Intensiv, Notarzt: ebenfalls nach Zeitraum gefiltert
  const records = Object.fromEntries(Object.entries(allRecords)
    .map(([kind, list]) => [kind, list.filter((r) => inRange(r, range)).reverse()]));
  return { range, entries, all, records, allRecords };
}

async function renderRangeInfo() {
  customRange.hidden = rangeChips.querySelector('input:checked').value !== 'custom';
  const { range, entries, records } = await entriesInRange();
  if (range.from && range.to && range.from > range.to) {
    rangeInfo.textContent = 'Das „von“-Datum liegt nach dem „bis“-Datum.';
    return;
  }
  const parts = [`${entries.length} ${entries.length === 1 ? 'Narkose' : 'Narkosen'}`];
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (records.measures.length) parts.push(plural(records.measures.length, 'Maßnahme', 'Maßnahmen'));
  if (records.icu.length) parts.push(plural(records.icu.length, 'Intensiv-Fall', 'Intensiv-Fälle'));
  if (records.emergencies.length) parts.push(plural(records.emergencies.length, 'Notarzteinsatz', 'Notarzteinsätze'));
  rangeInfo.textContent = `Zeitraum: ${range.label} – ${parts.join(', ')}.`;
}

rangeChips.addEventListener('change', renderRangeInfo);
fromInput.addEventListener('change', renderRangeInfo);
toInput.addEventListener('change', renderRangeInfo);
window.addEventListener('entries-changed', () => { renderRangeInfo().catch(() => {}); });

// ---------- Tabellen bauen ----------

const yes = (value) => (value ? 'ja' : '');

function anesthesiaRows(entries, settings) {
  const header = [
    'Datum', 'Allgemeinanästhesie', 'Rückenmarksnah', 'Block 1', 'Block 2', 'Sedierung/Standby',
    'Videolaryngoskopie', 'Fiberoptik', 'Sono', 'ZVK', 'Arterie',
    'Fachgebiet', 'ASA', 'ambulant/stationär', 'Kind < 5 J.', 'Notfall', 'Ort', 'Eingriff', 'Notiz',
    'Zählt als Verfahren',
  ];
  const rows = entries.map((e) => {
    const airway = e.airway || [];
    return [
      formatDate(e.date),
      e.general === 'keine' ? '' : e.general,
      e.neuraxial === 'keine' ? '' : e.neuraxial,
      e.block1, e.block2, yes(e.sedation),
      yes(airway.includes('Videolaryngoskopie')), yes(airway.includes('Fiberoptik')),
      yes(e.ultrasound), yes(e.cvc), yes(e.arterial),
      e.specialty, e.asa || '', e.setting, yes(e.childUnder5), yes(e.emergency),
      e.location, e.procedure, e.note,
      countProcedures(e, settings.countSeparately),
    ];
  });
  return [header, ...rows];
}

function summaryRows(range, entries, all, supplements, settings, records, allRecords) {
  const inPeriod = computeProgress(entries, [], settings, records);
  const overall = computeProgress(all, supplements, settings, allRecords);
  const rows = [
    [`Zusammenfassung Narkose-Logbuch – Zeitraum: ${range.label}`],
    [`Erstellt am ${formatDate(isoDay(new Date()))}. Zählregel: `
      + (settings.countSeparately ? 'jedes Verfahren einzeln' : '1 pro Patient')],
    [],
    ['Kategorie', 'Im Zeitraum (Einzelfälle)', 'Gesamtstand', 'davon Nachträge', 'Richtzahl', 'Gesamtstand in %'],
  ];
  COUNTABLE.forEach((c) => {
    const total = overall[c.id];
    rows.push([
      c.parent ? `– davon ${c.label}` : c.label,
      inPeriod[c.id].fromEntries,
      total.sum,
      total.fromSupplements,
      c.target,
      c.target ? Math.round((total.sum / c.target) * 100) : '',
    ]);
  });
  return rows;
}

// Schritt 6: Maßnahmen, Intensiv, Notarzt
function measureRows(measures) {
  const header = ['Datum', 'Maßnahme', 'Simulation', 'mit Ultraschall', 'Ort', 'Notiz'];
  return [header, ...measures.map((m) => [
    formatDate(m.date), m.type, yes(m.simulation), yes(m.ultrasound), m.location, m.note,
  ])];
}

function icuRows(cases) {
  const header = ['Datum', '≥ 2 Organsysteme gestört', 'Beatmung/Weaning', 'Notiz'];
  return [header, ...cases.map((c) => [formatDate(c.date), yes(c.organs2), yes(c.ventilation), c.note])];
}

function emergencyRows(emergencies) {
  const header = ['Datum', 'Rettungsmittel', 'Einsatzart/Stichwort', 'unter Anleitung von', 'Notiz'];
  return [header, ...emergencies.map((n) => [
    formatDate(n.date), n.vehicle, n.keyword, n.supervisor, n.note,
  ])];
}

function supplementRows(supplements) {
  const header = ['Kategorie', 'Anzahl', 'von', 'bis', 'Quelle', 'Notiz'];
  return [header, ...supplements.map((s) => [
    categoryLabel(s.category), s.amount, formatDate(s.from), formatDate(s.to), s.source, s.note,
  ])];
}

function csvFile(rows, name) {
  return new File([toCsv(rows)], name, { type: 'text/csv' });
}

function showMessage(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => { toast.hidden = true; }, 3500);
}

// ---------- Knöpfe ----------

document.getElementById('export-anesthesias').addEventListener('click', async () => {
  const [{ range, entries }, settings] = await Promise.all([entriesInRange(), getSettings()]);
  if (!entries.length) {
    showMessage('Im gewählten Zeitraum gibt es keine Narkosen.');
    return;
  }
  const file = csvFile(anesthesiaRows(entries, settings), `narkosen_${range.fileTag}.csv`);
  handOverFile(file, () => showMessage(`${entries.length} ${entries.length === 1 ? 'Narkose' : 'Narkosen'} exportiert.`));
});

document.getElementById('export-summary').addEventListener('click', async () => {
  const [{ range, entries, all, records, allRecords }, supplements, settings] = await Promise.all([
    entriesInRange(), listSupplements(), getSettings(),
  ]);
  const file = csvFile(
    summaryRows(range, entries, all, supplements, settings, records, allRecords),
    `zusammenfassung_${range.fileTag}.csv`,
  );
  handOverFile(file, () => showMessage('Zusammenfassung exportiert.'));
});

// Die drei Tabellen aus Schritt 6 funktionieren gleich: Knopf, Liste, Zeilen-Bauer, Dateiname.
[
  ['export-measures', 'measures', measureRows, 'massnahmen', 'Maßnahmen'],
  ['export-icu', 'icu', icuRows, 'intensiv', 'Intensiv-Fälle'],
  ['export-emergencies', 'emergencies', emergencyRows, 'notarzt', 'Notarzteinsätze'],
].forEach(([buttonId, kind, buildRows, filePrefix, label]) => {
  document.getElementById(buttonId).addEventListener('click', async () => {
    const { range, records } = await entriesInRange();
    const list = records[kind];
    if (!list.length) {
      showMessage(`Im gewählten Zeitraum gibt es keine ${label}.`);
      return;
    }
    const file = csvFile(buildRows(list), `${filePrefix}_${range.fileTag}.csv`);
    handOverFile(file, () => showMessage(`${list.length} ${label} exportiert.`));
  });
});

document.getElementById('export-supplements').addEventListener('click', async () => {
  const supplements = await listSupplements();
  if (!supplements.length) {
    showMessage('Es gibt noch keine Nachträge.');
    return;
  }
  const file = csvFile(supplementRows(supplements), `nachtraege_${isoDay(new Date())}.csv`);
  handOverFile(file, () => showMessage(`${supplements.length} ${supplements.length === 1 ? 'Nachtrag' : 'Nachträge'} exportiert.`));
});

renderRangeInfo().catch(() => {});
