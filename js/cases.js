// cases.js – der Reiter "Fälle": alle bisherigen Einträge als Liste,
// mit Suche, Filtern (Art, Zeitraum, Eingriff) und Bearbeiten/Löschen.
//
// So arbeitet die Datei mit den anderen zusammen (über "Ereignisse" = Nachrichten im Browser):
//   - "Bearbeiten" hier  -> schickt 'edit-entry'. app.js bzw. records.js füllen dann ihr Formular.
//   - Nach dem Speichern -> app.js/records.js schicken 'entry-saved'. Dann springen wir zurück hierher.
//   - "Abbrechen"         -> 'edit-cancelled', ebenfalls zurück hierher.
//   - Import/Backup       -> 'entries-changed'. Dann laden wir die Liste neu.

import {
  listAnesthesias, listRecords, deleteAnesthesia, deleteRecord,
} from './db.js';
import { KIND_LABELS, describeEntry, describeProcedures, formatDate } from './describe.js';
import { refreshOverview } from './overview.js';

// Wie viele Einträge auf einmal gezeigt werden. Mehr kommen per Knopf dazu.
// So bleibt es auch bei vielen hundert Fällen auf dem Handy flüssig.
const PAGE_SIZE = 50;

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// ---------- Elemente auf der Seite ----------

const panel = document.getElementById('tab-cases');
const tabButton = document.querySelector('.tab-bar button[data-tab="tab-cases"]');
const searchField = document.getElementById('cases-search');
const filterBox = document.getElementById('cases-filters');
const filterSummary = document.getElementById('cases-filter-summary');
const kindChips = document.getElementById('cases-kind');
const rangeChips = document.getElementById('cases-range');
const customRange = document.getElementById('cases-custom');
const fromField = document.getElementById('cases-from');
const toField = document.getElementById('cases-to');
const procedureField = document.getElementById('cases-procedure');
const procedureRow = document.getElementById('cases-procedure-row');
const resetButton = document.getElementById('cases-reset');
const resultInfo = document.getElementById('cases-result');
const listBox = document.getElementById('cases-list');
const moreButton = document.getElementById('cases-more');

// ---------- Zustand ----------

let allCases = [];   // alle Einträge aller Arten, schon fertig beschrieben (siehe loadCases)
let filtered = [];   // nur die, die gerade zu Suche und Filtern passen
let shown = PAGE_SIZE;
let needsReload = true;  // true = Daten haben sich geändert, beim nächsten Öffnen neu laden
let returnAfterEdit = false; // true = nach dem Bearbeiten wieder hierher zurück
let savedScroll = 0;

// ---------- Helfer ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function todayParts() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

const pad = (n) => String(n).padStart(2, '0');

// Text für die Suche vereinfachen: klein geschrieben, ohne Akzente (ä bleibt ä).
function normalize(text) {
  return String(text || '').toLocaleLowerCase('de').trim();
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2200);
}

// ---------- Daten laden ----------

// Holt alle vier Arten aus der Datenbank und bereitet sie EINMAL auf:
// Beschreibung und ein "Suchtext" pro Eintrag. Beim Tippen in die Suche
// muss dann nur noch verglichen werden – das geht auch bei 1000 Fällen schnell.
async function loadCases() {
  const [anesthesias, measures, icu, emergencies] = await Promise.all([
    listAnesthesias(), listRecords('measures'), listRecords('icu'), listRecords('emergencies'),
  ]);
  const lists = { anesthesia: anesthesias, measures, icu, emergencies };
  allCases = Object.entries(lists).flatMap(([kind, entries]) => entries.map((entry) => {
    const text = describeEntry(kind, entry);
    const searchText = normalize([
      KIND_LABELS[kind], text.title, text.details, ...text.tags, entry.note,
      entry.keyword, formatDate(entry.date),
    ].join(' '));
    return { kind, entry, text, searchText };
  }));
  // Neueste zuerst; am selben Tag der zuletzt angelegte oben.
  allCases.sort((a, b) => b.entry.date.localeCompare(a.entry.date)
    || String(b.entry.createdAt || '').localeCompare(String(a.entry.createdAt || '')));
  renderProcedureOptions(anesthesias);
  needsReload = false;
}

// Auswahlliste "Eingriff": jeder Eingriff aus den Narkosen einmal, mit Anzahl.
function renderProcedureOptions(anesthesias) {
  const current = procedureField.value;
  const counts = new Map();
  for (const entry of anesthesias) {
    const name = (entry.procedure || '').trim();
    if (!name) continue;
    const key = normalize(name);
    if (!counts.has(key)) counts.set(key, { name, count: 0 });
    counts.get(key).count += 1;
  }
  const options = [...counts.entries()]
    .sort((a, b) => a[1].name.localeCompare(b[1].name, 'de'))
    .map(([key, { name, count }]) => {
      const option = el('option', '', `${name} (${count})`);
      option.value = key;
      return option;
    });
  const all = el('option', '', 'Alle Eingriffe');
  all.value = '';
  procedureField.replaceChildren(all, ...options);
  // Bisherige Auswahl behalten, wenn es den Eingriff noch gibt
  procedureField.value = counts.has(current) ? current : '';
}

// ---------- Filtern ----------

function currentFilters() {
  return {
    words: normalize(searchField.value).split(/\s+/).filter(Boolean),
    kind: kindChips.querySelector('input:checked')?.value || 'all',
    range: rangeChips.querySelector('input:checked')?.value || 'all',
    procedure: procedureField.value,
  };
}

// Von–bis als Text "JJJJ-MM-TT" (leer = offen)
function dateBounds(range) {
  const { year, month } = todayParts();
  if (range === 'thisMonth' || range === 'lastMonth') {
    let y = year;
    let m = month;
    if (range === 'lastMonth') {
      m -= 1;
      if (m === 0) { m = 12; y -= 1; }
    }
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-31` };
  }
  if (range === 'thisYear') return { from: `${year}-01-01`, to: `${year}-12-31` };
  if (range === 'custom') return { from: fromField.value, to: toField.value };
  return { from: '', to: '' };
}

function applyFilters() {
  const f = currentFilters();
  const { from, to } = dateBounds(f.range);
  // Der Eingriff-Filter gilt nur für Narkosen (nur dort gibt es einen Eingriff)
  const useProcedure = f.procedure && (f.kind === 'all' || f.kind === 'anesthesia');

  filtered = allCases.filter((c) => {
    if (f.kind !== 'all' && c.kind !== f.kind) return false;
    if (from && c.entry.date < from) return false;
    if (to && c.entry.date > to) return false;
    if (useProcedure && (c.kind !== 'anesthesia' || normalize(c.entry.procedure) !== f.procedure)) return false;
    // Jedes Suchwort muss irgendwo vorkommen ("sectio spinal" findet Sectio in Spinal)
    return f.words.every((word) => c.searchText.includes(word));
  });

  // Anzeige oben: wie viele Filter sind an?
  const active = [f.kind !== 'all', f.range !== 'all', Boolean(useProcedure)].filter(Boolean).length;
  filterSummary.textContent = active ? `Filter (${active} aktiv)` : 'Filter';
  resetButton.hidden = !active && !f.words.length;
  procedureRow.hidden = !(f.kind === 'all' || f.kind === 'anesthesia');
  customRange.hidden = f.range !== 'custom';

  shown = PAGE_SIZE;
  renderList();
}

// ---------- Liste zeichnen ----------

function buildItem(c) {
  const item = el('li', 'entry');
  const head = el('div', 'entry-head');
  head.append(el('span', 'entry-date', formatDate(c.entry.date)), el('strong', '', c.text.title));
  item.append(head);
  if (c.text.details) item.append(el('div', 'entry-details', c.text.details));

  const tags = el('div', 'entry-tags');
  // Die Art (Narkose, Maßnahme …) als farbiges Schildchen, damit man sie in "Alle" unterscheidet
  tags.append(el('span', `tag kind-tag kind-${c.kind}`, KIND_LABELS[c.kind]));
  c.text.tags.forEach((tag) => tags.append(el('span', 'tag', tag)));
  item.append(tags);

  if (c.entry.note) item.append(el('div', 'entry-note', c.entry.note));

  const actions = el('div', 'entry-actions');
  const editButton = el('button', '', 'Bearbeiten');
  editButton.type = 'button';
  editButton.dataset.action = 'edit';
  const deleteButton = el('button', 'danger', 'Löschen');
  deleteButton.type = 'button';
  deleteButton.dataset.action = 'delete';
  actions.append(editButton, deleteButton);
  item.append(actions);

  // Merken, zu welchem Eintrag die Knöpfe gehören
  item.dataset.kind = c.kind;
  item.dataset.id = c.entry.id;
  return item;
}

function renderList() {
  const total = allCases.length;
  if (!total) {
    resultInfo.textContent = 'Noch keine Fälle. Neue Fälle legst du im Reiter „Neuer Fall“ an.';
  } else if (filtered.length === total) {
    resultInfo.textContent = `${total} ${total === 1 ? 'Fall' : 'Fälle'}`;
  } else {
    resultInfo.textContent = `${filtered.length} von ${total} Fällen gefunden`;
  }

  // Nach Monaten gruppiert: Überschrift "November 2026 (23)", darunter die Fälle.
  // Die Anzahl pro Monat zählt alle gefundenen, auch die noch nicht angezeigten.
  const perMonth = new Map();
  for (const c of filtered) {
    const key = c.entry.date.slice(0, 7);
    perMonth.set(key, (perMonth.get(key) || 0) + 1);
  }

  const fragment = document.createDocumentFragment();
  let currentMonth = null;
  let currentList = null;
  for (const c of filtered.slice(0, shown)) {
    const key = c.entry.date.slice(0, 7);
    if (key !== currentMonth) {
      currentMonth = key;
      const [y, m] = key.split('-');
      fragment.append(el('h3', 'month-title', `${MONTH_NAMES[Number(m) - 1]} ${y} (${perMonth.get(key)})`));
      currentList = el('ul', 'entry-list');
      fragment.append(currentList);
    }
    currentList.append(buildItem(c));
  }
  listBox.replaceChildren(fragment);

  const rest = filtered.length - shown;
  moreButton.hidden = rest <= 0;
  moreButton.textContent = `Weitere ${Math.min(rest, PAGE_SIZE)} anzeigen (noch ${rest})`;
}

// ---------- Öffnen und Neuladen ----------

async function refreshIfNeeded() {
  if (!needsReload) return;
  try {
    await loadCases();
    applyFilters();
  } catch (e) {
    resultInfo.textContent = `Die Fälle konnten nicht geladen werden: ${e.message}`;
  }
}

function markChanged() {
  needsReload = true;
  if (!panel.hidden) refreshIfNeeded();
}

// Wird der Reiter geöffnet, Liste aktualisieren (nur wenn sich etwas geändert hat)
tabButton.addEventListener('click', () => { refreshIfNeeded(); });

window.addEventListener('entries-changed', markChanged);
// Gelöscht anderswo? Neu laden. (Hier gelöscht: Liste ist schon aktuell.)
window.addEventListener('entry-deleted', (event) => {
  if (event.detail?.source !== 'cases') markChanged();
});

// Nach dem Speichern einer Bearbeitung: zurück zur Liste, an dieselbe Stelle
window.addEventListener('entry-saved', async (event) => {
  needsReload = true;
  if (returnAfterEdit && event.detail?.wasEditing) await backToList();
});
window.addEventListener('edit-cancelled', () => {
  if (returnAfterEdit) backToList();
});

async function backToList() {
  returnAfterEdit = false;
  tabButton.click();
  await refreshIfNeeded();
  window.scrollTo({ top: savedScroll });
}

// ---------- Bedienung ----------

// Suche: kurz warten, bis man aufhört zu tippen ("Entprellen"), dann filtern.
let searchTimer;
searchField.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(applyFilters, 150);
});

filterBox.addEventListener('change', applyFilters);

resetButton.addEventListener('click', () => {
  searchField.value = '';
  kindChips.querySelector('input[value="all"]').checked = true;
  rangeChips.querySelector('input[value="all"]').checked = true;
  procedureField.value = '';
  fromField.value = '';
  toField.value = '';
  applyFilters();
});

moreButton.addEventListener('click', () => {
  shown += PAGE_SIZE;
  renderList();
});

// Bearbeiten / Löschen (ein Zuhörer für die ganze Liste statt einer pro Knopf)
listBox.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const item = button.closest('li.entry');
  const { kind, id } = item.dataset;
  const found = allCases.find((c) => c.kind === kind && c.entry.id === id);
  if (!found) return;

  if (button.dataset.action === 'edit') {
    savedScroll = window.scrollY;
    returnAfterEdit = true;
    // Zum Reiter "Neuer Fall" wechseln; app.js bzw. records.js füllen das Formular
    document.querySelector('.tab-bar button[data-tab="tab-new"]').click();
    window.dispatchEvent(new CustomEvent('edit-entry', { detail: { kind, id } }));
    window.scrollTo({ top: 0 });
    return;
  }

  const name = kind === 'anesthesia' ? describeProcedures(found.entry) : found.text.title;
  if (!confirm(`${KIND_LABELS[kind]} vom ${formatDate(found.entry.date)} (${name}) wirklich löschen?`)) return;
  if (kind === 'anesthesia') await deleteAnesthesia(id);
  else await deleteRecord(kind, id);
  // Sofort aus der Liste nehmen, ohne alles neu zu laden
  allCases = allCases.filter((c) => c !== found);
  const scroll = window.scrollY;
  const keepShown = shown;
  applyFilters();
  shown = keepShown;
  renderList();
  window.scrollTo({ top: scroll });
  // Den anderen Bescheid geben (Formular, Vorschläge, Übersicht)
  window.dispatchEvent(new CustomEvent('entry-deleted', { detail: { kind, id, source: 'cases' } }));
  refreshOverview().catch(() => {});
  showToast('Eintrag gelöscht');
});
