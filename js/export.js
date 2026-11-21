// export.js – Export als Tabelle (CSV) für Excel, wahlweise nur für einen Zeitraum (z. B. Monatsabschluss).
//
// Drei Tabellen:
//   1) Narkosen: eine Zeile pro Patient, alle Felder – zum Nachschauen und Übertragen ins eLogbuch.
//   2) Zusammenfassung: Zahl pro WBO-Kategorie im Zeitraum, dazu der Gesamtstand.
//   3) Nachträge: alle Sammelzahlen.
// Fallnummern gibt es in der App nicht, also stehen auch keine in der Datei.

import { listAnesthesias, listSupplements, getSettings } from './db.js';
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
  const all = await listAnesthesias();
  // Für die Tabelle älteste zuerst (wie in einem Logbuch).
  const entries = all.filter((e) => inRange(e, range)).reverse();
  return { range, entries, all };
}

async function renderRangeInfo() {
  customRange.hidden = rangeChips.querySelector('input:checked').value !== 'custom';
  const { range, entries } = await entriesInRange();
  if (range.from && range.to && range.from > range.to) {
    rangeInfo.textContent = 'Das „von“-Datum liegt nach dem „bis“-Datum.';
    return;
  }
  rangeInfo.textContent = `Zeitraum: ${range.label} – ${entries.length} `
    + `${entries.length === 1 ? 'Narkose' : 'Narkosen'}.`;
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

function summaryRows(range, entries, all, supplements, settings) {
  const inPeriod = computeProgress(entries, [], settings);
  const overall = computeProgress(all, supplements, settings);
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
  const [{ range, entries, all }, supplements, settings] = await Promise.all([
    entriesInRange(), listSupplements(), getSettings(),
  ]);
  const file = csvFile(
    summaryRows(range, entries, all, supplements, settings),
    `zusammenfassung_${range.fileTag}.csv`,
  );
  handOverFile(file, () => showMessage('Zusammenfassung exportiert.'));
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
