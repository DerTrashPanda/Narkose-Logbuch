// import.js – der Bereich "Alte Tabelle importieren" im Reiter Export.
//
// Ablauf: Datei wählen → Spalten zuordnen → Vorschau prüfen → importieren.
// Nichts wird gespeichert, bevor man auf "importieren" tippt.
// Die Datei verlässt das Gerät nicht: Sie wird nur hier im Browser gelesen.

import { decodeBytes, parseCsv } from './csv.js';
import {
  TARGETS, suggestMapping, convertAll,
} from './import-mapping.js';
import {
  listAnesthesias, saveImportedAnesthesias, deleteImportedAnesthesias, getSettings, saveSetting,
} from './db.js';

const fileInput = document.getElementById('import-file');
const fileError = document.getElementById('import-error');
const mappingStep = document.getElementById('import-step-mapping');
const mappingList = document.getElementById('import-mapping');
const sectioOption = document.getElementById('import-sectio');
const previewStep = document.getElementById('import-step-preview');
const summary = document.getElementById('import-summary');
const duplicateWarning = document.getElementById('import-duplicate');
const warningList = document.getElementById('import-warnings');
const skippedList = document.getElementById('import-skipped');
const allList = document.getElementById('import-all');
const warningCount = document.getElementById('import-warning-count');
const skippedCount = document.getElementById('import-skipped-count');
const allCount = document.getElementById('import-all-count');
const confirmButton = document.getElementById('import-confirm');
const cancelButton = document.getElementById('import-cancel');
const lastImportBox = document.getElementById('import-last');
const lastImportText = document.getElementById('import-last-text');
const undoButton = document.getElementById('import-undo');

// Zwischenspeicher, solange man in der Vorschau ist (nur im Arbeitsspeicher, nicht in der Datenbank)
let rows = [];
let mapping = [];
let results = [];

// "2026-11-21" -> "21.11.2026"
function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

function describe(entry) {
  const parts = [];
  if (entry.general !== 'keine') parts.push(entry.general);
  if (entry.neuraxial !== 'keine') parts.push(entry.neuraxial);
  if (entry.block1) parts.push(entry.block1);
  if (entry.block2) parts.push(entry.block2);
  if (entry.sedation) parts.push('Sedierung');
  if (entry.cvc) parts.push('ZVK');
  if (entry.arterial) parts.push('Arterie');
  const details = [entry.specialty, entry.asa ? `ASA ${entry.asa}` : '',
    entry.setting === 'ambulant' ? 'ambulant' : '', entry.childUnder5 ? 'Kind < 5 J.' : '',
    entry.procedure].filter(Boolean);
  return `${parts.join(' + ')}${details.length ? ` · ${details.join(' · ')}` : ''}`;
}

// Ein Listeneintrag der Vorschau: "Zeile 12 · 24.03.2026 · ITN · Abdominell …" plus Hinweise
function previewItem(result, text) {
  const item = document.createElement('li');
  const head = document.createElement('div');
  head.className = 'entry-details';
  const date = result.entry.date ? formatDate(result.entry.date) : '';
  head.textContent = `Zeile ${result.line}${date ? ` · ${date}` : ''}`;
  const body = document.createElement('div');
  body.textContent = text;
  item.append(head, body);
  return item;
}

// ---------- Schritt 1: Spalten zuordnen ----------

function renderMapping() {
  const headers = rows[0];
  mappingList.replaceChildren(...headers.map((header, index) => {
    const row = document.createElement('label');
    row.className = 'mapping-row';
    const name = document.createElement('span');
    name.className = 'mapping-header';
    name.textContent = header || `(Spalte ${index + 1} ohne Überschrift)`;

    if (mapping[index] === 'forbidden') {
      // Datenschutz: diese Spalte kann man nicht auswählen
      const note = document.createElement('span');
      note.className = 'mapping-forbidden';
      note.textContent = 'wird nicht übernommen (Datenschutz)';
      row.append(name, note);
      return row;
    }

    const select = document.createElement('select');
    select.dataset.index = index;
    TARGETS.forEach((target) => {
      const option = document.createElement('option');
      option.value = target.id;
      option.textContent = target.label;
      select.append(option);
    });
    select.value = mapping[index];
    row.append(name, select);
    return row;
  }));
}

mappingList.addEventListener('change', (event) => {
  const select = event.target.closest('select');
  if (!select) return;
  mapping[Number(select.dataset.index)] = select.value;
  renderPreview();
});
sectioOption.addEventListener('change', () => renderPreview());

// ---------- Schritt 2: Vorschau ----------

async function renderPreview() {
  if (!mapping.includes('date')) {
    previewStep.hidden = true;
    fileError.textContent = 'Bitte einer Spalte „Datum“ zuordnen.';
    fileError.hidden = false;
    return;
  }
  fileError.hidden = true;
  results = convertAll(rows, mapping, { sectioFromProcedure: sectioOption.checked });
  const toImport = results.filter((r) => !r.skipReason);
  const skipped = results.filter((r) => r.skipReason);
  const withWarnings = toImport.filter((r) => r.warnings.length);

  const dates = toImport.map((r) => r.entry.date).sort();
  summary.textContent = toImport.length
    ? `${results.length} Zeilen gelesen. ${toImport.length} Narkosen werden importiert`
      + ` (${formatDate(dates[0])} bis ${formatDate(dates[dates.length - 1])}),`
      + ` ${skipped.length} Zeilen übersprungen, ${withWarnings.length} mit Hinweis.`
    : `${results.length} Zeilen gelesen, aber keine davon kann importiert werden.`;

  warningCount.textContent = `(${withWarnings.length})`;
  warningList.replaceChildren(...withWarnings.map((r) => previewItem(r, `${describe(r.entry)} – ${r.warnings.join('; ')}`)));
  skippedCount.textContent = `(${skipped.length})`;
  skippedList.replaceChildren(...skipped.map((r) => previewItem(r, r.skipReason)));
  allCount.textContent = `(${toImport.length})`;
  allList.replaceChildren(...toImport.map((r) => previewItem(r, describe(r.entry))));

  // Schon einmal importiert? Dann warnen, damit nichts doppelt zählt.
  const existing = await listAnesthesias();
  const alreadyImported = existing.filter((e) => e.importId).length;
  duplicateWarning.hidden = alreadyImported === 0;
  duplicateWarning.textContent = `Achtung: Es gibt schon ${alreadyImported} importierte Narkosen. `
    + 'Wenn das dieselbe Tabelle ist, würden die Fälle doppelt zählen. '
    + 'Mach dann zuerst unten „Letzten Import rückgängig machen“.';

  confirmButton.disabled = toImport.length === 0;
  confirmButton.textContent = `${toImport.length} Narkosen importieren`;
  previewStep.hidden = false;
}

// ---------- Datei wählen ----------

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  fileError.hidden = true;
  mappingStep.hidden = true;
  previewStep.hidden = true;

  if (/\.xlsx?$/i.test(file.name)) {
    showFileError('Das ist eine Excel-Datei. Bitte in Excel zuerst als „CSV UTF-8“ speichern (Anleitung oben).');
    return;
  }
  try {
    rows = parseCsv(decodeBytes(await file.arrayBuffer()));
  } catch (e) {
    showFileError(`Die Datei konnte nicht gelesen werden: ${e.message}`);
    return;
  }
  if (rows.length < 2) {
    showFileError('In der Datei stehen keine Zeilen unter der Überschrift.');
    return;
  }
  mapping = suggestMapping(rows[0]);
  renderMapping();
  mappingStep.hidden = false;
  await renderPreview();
  mappingStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function showFileError(message) {
  fileError.textContent = message;
  fileError.hidden = false;
  fileInput.value = '';
}

function closeImport() {
  rows = [];
  mapping = [];
  results = [];
  fileInput.value = '';
  mappingStep.hidden = true;
  previewStep.hidden = true;
  fileError.hidden = true;
}

cancelButton.addEventListener('click', closeImport);

// ---------- Schritt 3: importieren ----------

confirmButton.addEventListener('click', async () => {
  const entries = results.filter((r) => !r.skipReason).map((r) => r.entry);
  if (!entries.length) return;
  confirmButton.disabled = true;
  const importId = `import-${new Date().toISOString()}`;
  try {
    await saveImportedAnesthesias(entries, importId);
    await saveSetting('lastImport', { id: importId, count: entries.length, at: new Date().toISOString() });
  } catch (e) {
    fileError.textContent = `Import hat nicht geklappt, es wurde nichts gespeichert: ${e.message}`;
    fileError.hidden = false;
    confirmButton.disabled = false;
    return;
  }
  closeImport();
  // Liste und Übersicht in den anderen Reitern neu laden (app.js hört darauf)
  window.dispatchEvent(new Event('entries-changed'));
  await renderLastImport();
  showMessage(`${entries.length} Narkosen importiert. Schau in „Neuer Fall“ und „Übersicht“.`);
});

// ---------- Letzten Import rückgängig machen ----------

async function renderLastImport() {
  const { lastImport } = await getSettings();
  lastImportBox.hidden = !lastImport;
  if (lastImport) {
    const date = formatDate(lastImport.at.slice(0, 10));
    lastImportText.textContent = `Letzter Import: ${lastImport.count} Narkosen am ${date}.`;
  }
}

undoButton.addEventListener('click', async () => {
  const { lastImport } = await getSettings();
  if (!lastImport) return;
  if (!confirm(`Alle ${lastImport.count} Narkosen aus dem letzten Import löschen? `
    + 'Selbst eingetragene Fälle bleiben erhalten.')) return;
  const deleted = await deleteImportedAnesthesias(lastImport.id);
  await saveSetting('lastImport', null);
  window.dispatchEvent(new Event('entries-changed'));
  await renderLastImport();
  showMessage(`${deleted} importierte Narkosen gelöscht.`);
});

function showMessage(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 3500);
}

renderLastImport().catch(() => {});
