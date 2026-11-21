// overview.js – Reiter "Übersicht" (Fortschritt je Kategorie, Nachträge)
// und die Einstellungen im Reiter "Profil".
// Die Zählregeln selbst stehen in counting.js.

import {
  listAnesthesias, listSupplements, saveSupplement, deleteSupplement, getSettings, saveSetting,
} from './db.js';
import {
  CATEGORIES, COUNTABLE, computeProgress, categoryLabel,
} from './counting.js';

const SOURCES = ['Schätzung', 'Statistik-Export', 'Bescheinigung'];

const progressList = document.getElementById('progress-list');
const countRule = document.getElementById('count-rule');
const supplementList = document.getElementById('supplement-list');
const supplementCount = document.getElementById('supplement-count');
const emptySupplements = document.getElementById('empty-supplements');
const dialog = document.getElementById('supplement-dialog');
const supplementForm = document.getElementById('supplement-form');
const supplementError = document.getElementById('supplement-error');
const countSeparatelySwitch = document.getElementById('setting-count-separately');

// "2026-11-21" -> "21.11.2026"
function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

// Kleiner Helfer: Element mit Klasse und Text bauen (immer textContent, nie innerHTML).
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- Fortschrittsbalken ----------

function renderProgress(progress, settings) {
  countRule.textContent = settings.countSeparately
    ? 'Zählregel: Jedes Verfahren einzeln (z. B. ITN + PDK = 2). Änderbar im Profil.'
    : 'Zählregel: 1 Patient = 1 Verfahren. Änderbar im Profil.';

  const nodes = [];
  let list = null;
  for (const category of CATEGORIES) {
    if (category.group) {
      // Zwischenüberschrift, danach eine neue Liste
      nodes.push(el('h3', 'section-title', category.group));
      list = el('ul', 'progress-list');
      nodes.push(list);
      continue;
    }
    list.append(renderProgressItem(category, progress[category.id]));
  }
  progressList.replaceChildren(...nodes);
}

function renderProgressItem(category, row) {
  const item = el('li', category.parent ? 'progress-item sub' : 'progress-item');
  const done = row.sum >= category.target;
  if (done) item.classList.add('done');

  // Kopfzeile: "Regionalanästhesie      34 von 50"
  const head = el('div', 'progress-head');
  const label = el('span', 'progress-label', category.parent ? `davon ${category.label}` : category.label);
  const numbers = el('span', 'progress-numbers');
  numbers.append(el('strong', '', String(row.sum)), ` von ${category.target}`);
  if (done) numbers.append(' ✓');
  head.append(label, numbers);

  // Balken: dunkler Teil = einzeln erfasste Fälle, hellerer Teil = Nachträge.
  // Über 100 % wird der Balken nicht länger als voll.
  const bar = el('div', 'bar');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `${row.sum} von ${category.target}`);
  const entriesPart = Math.min(row.fromEntries / category.target, 1) * 100;
  const supplementPart = Math.min(row.sum / category.target, 1) * 100 - entriesPart;
  const fillEntries = el('div', 'bar-fill');
  fillEntries.style.width = `${entriesPart}%`;
  const fillSupplements = el('div', 'bar-fill supplement');
  fillSupplements.style.width = `${supplementPart}%`;
  bar.append(fillEntries, fillSupplements);

  // Fußzeile: "davon 5 Nachtrag" + Hinweise + Knopf
  const foot = el('div', 'progress-foot');
  const info = [];
  if (row.fromSupplements) info.push(`davon ${row.fromSupplements} Nachtrag`);
  if (!done) info.push(`noch ${category.target - row.sum}`);
  if (category.simLimit) info.push(`höchstens ${category.simLimit} % Simulation`);
  if (category.later) info.push(category.later);
  foot.append(el('span', 'hint', info.join(' · ')));
  const addButton = el('button', 'small-button', '＋ Nachtrag');
  addButton.type = 'button';
  addButton.dataset.category = category.id;
  addButton.setAttribute('aria-label', `Nachtrag für ${category.label}`);
  foot.append(addButton);

  item.append(head, bar, foot);
  return item;
}

// ---------- Liste der Nachträge ----------

function describePeriod(s) {
  if (s.from && s.to) return `${formatDate(s.from)} – ${formatDate(s.to)}`;
  if (s.from) return `ab ${formatDate(s.from)}`;
  if (s.to) return `bis ${formatDate(s.to)}`;
  return '';
}

function renderSupplements(supplements) {
  emptySupplements.hidden = supplements.length > 0;
  supplementCount.textContent = supplements.length ? `(${supplements.length})` : '';
  supplementList.replaceChildren(...supplements.map((s) => {
    const item = el('li', 'entry');
    const head = el('div', 'entry-head');
    head.append(el('strong', '', `${s.amount} × ${categoryLabel(s.category)}`));
    const details = el('div', 'entry-details',
      [describePeriod(s), s.source].filter(Boolean).join(' · '));
    item.append(head, details);
    if (s.note) item.append(el('div', 'entry-note', s.note));
    const actions = el('div', 'entry-actions');
    const deleteButton = el('button', 'danger', 'Löschen');
    deleteButton.type = 'button';
    deleteButton.dataset.id = s.id;
    actions.append(deleteButton);
    item.append(actions);
    return item;
  }));
}

// ---------- Alles neu berechnen ----------

let currentSupplements = [];

export async function refreshOverview() {
  const [entries, supplements, settings] = await Promise.all([
    listAnesthesias(), listSupplements(), getSettings(),
  ]);
  currentSupplements = supplements;
  renderProgress(computeProgress(entries, supplements, settings), settings);
  renderSupplements(supplements);
  countSeparatelySwitch.checked = settings.countSeparately;
}

// ---------- Nachtrag-Fenster ----------

function setupSupplementForm() {
  const select = supplementForm.elements.category;
  select.replaceChildren(...COUNTABLE.map((c) => {
    const option = el('option', '', c.parent ? `– davon ${c.label}` : c.label);
    option.value = c.id;
    return option;
  }));

  const sources = document.getElementById('supplement-sources');
  sources.replaceChildren(...SOURCES.map((source) => {
    const chip = el('label', 'chip');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'source';
    input.value = source;
    chip.append(input, el('span', '', source));
    return chip;
  }));
}

function openSupplementDialog(categoryId) {
  supplementForm.reset();
  supplementError.hidden = true;
  supplementForm.elements.category.value = categoryId || 'total';
  supplementForm.querySelector('input[name="source"][value="Schätzung"]').checked = true;
  dialog.showModal();
  supplementForm.elements.amount.focus();
}

function readSupplementForm() {
  const f = supplementForm.elements;
  return {
    category: f.category.value,
    amount: Number(f.amount.value),
    from: f.from.value,
    to: f.to.value,
    source: supplementForm.querySelector('input[name="source"]:checked')?.value || '',
    note: f.note.value.trim(),
  };
}

function validateSupplement(s) {
  if (!Number.isInteger(s.amount) || s.amount < 1) return 'Bitte eine ganze Zahl ab 1 eingeben.';
  if (s.from && s.to && s.from > s.to) return '„Von“ muss vor „bis“ liegen.';
  return null;
}

supplementForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const supplement = readSupplementForm();
  const error = validateSupplement(supplement);
  if (error) {
    supplementError.textContent = error;
    supplementError.hidden = false;
    return;
  }
  await saveSupplement(supplement);
  dialog.close();
  await refreshOverview();
});

document.getElementById('supplement-cancel').addEventListener('click', () => dialog.close());
document.getElementById('add-supplement').addEventListener('click', () => openSupplementDialog());

progressList.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-category]');
  if (button) openSupplementDialog(button.dataset.category);
});

supplementList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const supplement = currentSupplements.find((s) => s.id === button.dataset.id);
  if (!supplement) return;
  const question = `Nachtrag „${supplement.amount} × ${categoryLabel(supplement.category)}“ wirklich löschen?`;
  if (!confirm(question)) return;
  await deleteSupplement(supplement.id);
  await refreshOverview();
});

// ---------- Einstellungen im Profil ----------

countSeparatelySwitch.addEventListener('change', async () => {
  await saveSetting('countSeparately', countSeparatelySwitch.checked);
  await refreshOverview();
});

setupSupplementForm();
