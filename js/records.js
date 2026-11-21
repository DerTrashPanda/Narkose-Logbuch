// records.js – Schritt 6: Maßnahmen, Intensiv-Fälle und Notarzteinsätze erfassen.
//
// Oben im Reiter "Neuer Fall" wählt man, WAS man erfassen will:
//   Narkose (macht weiter app.js) · Maßnahme · Intensiv · Notarzt (macht diese Datei).
// Die drei Formulare hier funktionieren alle gleich. Was sie unterscheidet,
// steht unten in KINDS – eine Art "Bauanleitung" pro Formular.
// Das Speichern selbst erledigt db.js.

import {
  saveRecord, getRecord, listRecords, deleteRecord, requestPersistentStorage,
} from './db.js';
import {
  MEASURE_TYPES, MEASURE_TYPES_WITH_ULTRASOUND, MEASURE_LOCATIONS, EMERGENCY_VEHICLES,
} from './options.js';
import { refreshOverview } from './overview.js';

// ---------- Bauanleitung pro Art ----------
//   groups  – Chip-Gruppen (radio = genau eins wählbar). deselectable: nochmal tippen hebt auf.
//             addOwn: man kann eigene Werte ergänzen; sie erscheinen beim nächsten Mal als Chip.
//   toggles – einzelne Ja/Nein-Chips: { name: 'Beschriftung' }
//   texts   – Textfelder im Formular (name-Attribute)
//   keep    – diese Werte bleiben nach dem Speichern stehen (praktisch für mehrere Einträge am Stück)
//   validate – gibt eine Fehlermeldung zurück oder null
//   title / details / tags – wie der Eintrag in der Liste aussieht
const KINDS = {
  measures: {
    singular: 'Maßnahme',
    newTitle: 'Neue Maßnahme',
    editTitle: 'Maßnahme bearbeiten',
    groups: {
      type: { options: MEASURE_TYPES },
      location: { options: MEASURE_LOCATIONS, deselectable: true, addOwn: true },
    },
    toggles: { simulation: 'Simulation', ultrasound: 'mit Ultraschall' },
    texts: ['note'],
    keep: ['date', 'location'],
    validate: (r) => (r.type ? null : 'Bitte antippen, welche Maßnahme es war.'),
    title: (r) => r.type,
    details: (r) => [r.location],
    tags: (r) => [r.simulation && 'Simulation', r.ultrasound && 'Ultraschall', r.importId && 'aus Import'],
  },
  icu: {
    singular: 'Intensiv-Fall',
    newTitle: 'Neuer Intensiv-Fall',
    editTitle: 'Intensiv-Fall bearbeiten',
    groups: {},
    toggles: { organs2: '≥ 2 Organsysteme gestört', ventilation: 'Beatmung/Weaning' },
    texts: ['note'],
    keep: ['date'],
    validate: (r) => (r.organs2 || r.ventilation
      ? null
      : 'Bitte mindestens eines antippen: „≥ 2 Organsysteme gestört“ oder „Beatmung/Weaning“. Sonst zählt der Fall nirgends.'),
    title: (r) => [r.organs2 && '≥ 2 Organsysteme', r.ventilation && 'Beatmung/Weaning'].filter(Boolean).join(' + '),
    details: () => [],
    tags: () => [],
  },
  emergencies: {
    singular: 'Notarzteinsatz',
    newTitle: 'Neuer Notarzteinsatz',
    editTitle: 'Notarzteinsatz bearbeiten',
    groups: {
      vehicle: { options: EMERGENCY_VEHICLES, defaultValue: 'NEF' },
    },
    toggles: {},
    texts: ['keyword', 'supervisor', 'note'],
    keep: ['date', 'vehicle', 'supervisor'],
    validate: () => null,
    title: (r) => [r.vehicle, r.keyword].filter(Boolean).join(' · '),
    details: (r) => [r.supervisor && `unter Anleitung: ${r.supervisor}`],
    tags: () => [],
  },
};

// ---------- kleine Helfer ----------

function todayString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2200);
}

// Element mit Klasse und Text bauen (immer textContent, nie innerHTML – sicher bei Notizen).
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createChip(type, name, value, label) {
  const chip = el('label', 'chip');
  const input = document.createElement('input');
  input.type = type;
  input.name = name;
  input.value = value;
  chip.append(input, el('span', '', label));
  return chip;
}

// Feste Liste + alles, was in alten Einträgen schon mal vorkam (z. B. selbst ergänzte Orte).
function mergeOptions(defaults, usedValues) {
  const extras = [...new Set(usedValues)]
    .filter((value) => value && !defaults.includes(value))
    .sort((a, b) => a.localeCompare(b, 'de'));
  return [...defaults, ...extras];
}

// ---------- Ein Formular samt Liste ----------

// Baut für eine Art (z. B. 'measures') alles auf: Chips, Speichern, Liste, Bearbeiten, Löschen.
function setupKind(kind) {
  const config = KINDS[kind];
  const panel = document.getElementById(`kind-${kind}`);
  const form = panel.querySelector('form');
  const formTitle = panel.querySelector('[data-role="title"]');
  const saveButton = panel.querySelector('[data-role="save"]');
  const cancelButton = panel.querySelector('[data-role="cancel"]');
  const formError = panel.querySelector('[data-role="error"]');
  const list = panel.querySelector('[data-role="list"]');
  const empty = panel.querySelector('[data-role="empty"]');
  const count = panel.querySelector('[data-role="count"]');

  let editing = null; // der Eintrag, der gerade bearbeitet wird (oder null)
  let records = [];

  const checkedValues = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)]
    .map((input) => input.value);
  const setChecked = (name, values) => {
    form.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
      input.checked = values.includes(input.value);
    });
  };

  // Ja/Nein-Chips einmalig anlegen
  for (const [name, label] of Object.entries(config.toggles)) {
    form.querySelector(`[data-toggle="${name}"]`)
      .replaceChildren(createChip('checkbox', name, 'ja', label));
  }

  function renderGroups() {
    for (const [name, group] of Object.entries(config.groups)) {
      const options = group.addOwn ? mergeOptions(group.options, records.map((r) => r[name])) : group.options;
      form.querySelector(`[data-group="${name}"]`)
        .replaceChildren(...options.map((option) => createChip('radio', name, option, option)));
    }
  }

  // Vorschläge für Textfelder (z. B. Einsatzstichwort) aus bisherigen Einträgen
  function renderSuggestions() {
    form.querySelectorAll('datalist[data-suggest]').forEach((datalist) => {
      const field = datalist.dataset.suggest;
      const values = [...new Set(records.map((r) => r[field]).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'de'));
      datalist.replaceChildren(...values.map((value) => {
        const option = document.createElement('option');
        option.value = value;
        return option;
      }));
    });
  }

  function resetForm(keep = {}) {
    form.reset();
    for (const [name, group] of Object.entries(config.groups)) {
      setChecked(name, group.defaultValue ? [group.defaultValue] : []);
    }
    form.elements.date.value = keep.date || todayString();
    for (const name of config.keep) {
      if (name === 'date' || !keep[name]) continue;
      if (config.groups[name]) setChecked(name, [keep[name]]);
      else form.elements[name].value = keep[name];
    }
    editing = null;
    formTitle.textContent = config.newTitle;
    saveButton.textContent = 'Speichern';
    cancelButton.hidden = true;
    formError.hidden = true;
  }

  function fillForm(record) {
    resetForm();
    form.elements.date.value = record.date;
    for (const name of Object.keys(config.groups)) setChecked(name, record[name] ? [record[name]] : []);
    for (const name of Object.keys(config.toggles)) setChecked(name, record[name] ? ['ja'] : []);
    for (const name of config.texts) form.elements[name].value = record[name] || '';
    editing = record;
    formTitle.textContent = config.editTitle;
    saveButton.textContent = 'Änderung speichern';
    cancelButton.hidden = false;
  }

  function readForm() {
    // Beim Bearbeiten bleiben unbekannte Felder (z. B. importId) erhalten
    const record = editing ? { ...editing } : {};
    record.date = form.elements.date.value;
    for (const name of Object.keys(config.groups)) record[name] = checkedValues(name)[0] || '';
    for (const name of Object.keys(config.toggles)) record[name] = checkedValues(name).length > 0;
    for (const name of config.texts) record[name] = form.elements[name].value.trim();
    return record;
  }

  function renderList() {
    empty.hidden = records.length > 0;
    count.textContent = records.length ? `(${records.length})` : '';
    list.replaceChildren(...records.map((record) => {
      const item = el('li', 'entry');
      const head = el('div', 'entry-head');
      head.append(el('span', 'entry-date', formatDate(record.date)),
        el('strong', '', config.title(record) || config.singular));
      item.append(head);

      const details = config.details(record).filter(Boolean);
      if (details.length) item.append(el('div', 'entry-details', details.join(' · ')));
      const tags = config.tags(record).filter(Boolean);
      if (tags.length) {
        const tagBox = el('div', 'entry-tags');
        tags.forEach((tag) => tagBox.append(el('span', 'tag', tag)));
        item.append(tagBox);
      }
      if (record.note) item.append(el('div', 'entry-note', record.note));

      const actions = el('div', 'entry-actions');
      const editButton = el('button', '', 'Bearbeiten');
      editButton.type = 'button';
      editButton.dataset.action = 'edit';
      editButton.dataset.id = record.id;
      const deleteButton = el('button', 'danger', 'Löschen');
      deleteButton.type = 'button';
      deleteButton.dataset.action = 'delete';
      deleteButton.dataset.id = record.id;
      actions.append(editButton, deleteButton);
      item.append(actions);
      return item;
    }));
  }

  async function refresh(keep) {
    records = await listRecords(kind);
    renderGroups();
    renderSuggestions();
    renderList();
    resetForm(keep);
  }

  // Radio-Chips: ein zweites Tippen auf den gewählten Chip hebt die Auswahl auf (wo erlaubt)
  const checkedBeforeClick = {};
  form.addEventListener('pointerdown', (event) => {
    const input = event.target.closest('.chip')?.querySelector('input[type="radio"]');
    if (input) checkedBeforeClick[input.name] = input.checked ? input.value : null;
  });
  form.addEventListener('click', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'radio') return;
    if (config.groups[input.name]?.deselectable && checkedBeforeClick[input.name] === input.value) {
      input.checked = false;
    }
    checkedBeforeClick[input.name] = null;
  });

  form.addEventListener('change', (event) => {
    formError.hidden = true;
    // Sono-gesteuerte Punktion: "mit Ultraschall" gleich mit anhaken
    const input = event.target;
    if (input.name === 'type' && MEASURE_TYPES_WITH_ULTRASOUND.includes(input.value)) {
      setChecked('ultrasound', ['ja']);
    }
  });

  // Eigenen Wert ergänzen (z. B. "Anderer Ort")
  form.querySelectorAll('[data-add-for]').forEach((field) => {
    const add = () => {
      const value = field.value.trim();
      if (!value) return;
      const name = field.dataset.addFor;
      const container = form.querySelector(`[data-group="${name}"]`);
      if (![...container.querySelectorAll('input')].some((i) => i.value === value)) {
        container.append(createChip('radio', name, value, value));
      }
      setChecked(name, [value]);
      field.value = '';
    };
    form.querySelector(`[data-add-button="${field.dataset.addFor}"]`).addEventListener('click', add);
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        add();
      }
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const record = readForm();
    const error = !record.date ? 'Bitte ein Datum angeben.' : config.validate(record);
    if (error) {
      formError.textContent = error;
      formError.hidden = false;
      formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const wasEditing = Boolean(editing);
    try {
      await saveRecord(kind, record);
    } catch (e) {
      formError.textContent = `Speichern hat nicht geklappt: ${e.message}`;
      formError.hidden = false;
      return;
    }
    requestPersistentStorage();
    const keep = wasEditing ? {} : Object.fromEntries(config.keep.map((name) => [name, record[name]]));
    await refresh(keep);
    refreshOverview().catch(() => {});
    showToast(wasEditing ? 'Änderung gespeichert' : `${config.singular} gespeichert`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  cancelButton.addEventListener('click', () => resetForm());

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const record = await getRecord(kind, button.dataset.id);
    if (!record) return;
    if (button.dataset.action === 'edit') {
      fillForm(record);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const name = config.title(record) || config.singular;
    if (!confirm(`${config.singular} vom ${formatDate(record.date)} (${name}) wirklich löschen?`)) return;
    await deleteRecord(kind, record.id);
    if (editing?.id === record.id) resetForm();
    records = await listRecords(kind);
    renderList();
    refreshOverview().catch(() => {});
    showToast('Eintrag gelöscht');
  });

  return refresh;
}

// ---------- Umschalter oben: Narkose / Maßnahme / Intensiv / Notarzt ----------

const kindSwitch = document.getElementById('kind-switch');
const KIND_PANELS = ['anesthesia', ...Object.keys(KINDS)];
const SWITCH_STORAGE_KEY = 'narkose-logbuch-kind';

function showKind(kind) {
  KIND_PANELS.forEach((name) => {
    document.getElementById(`kind-${name}`).hidden = name !== kind;
  });
  const input = kindSwitch.querySelector(`input[value="${kind}"]`);
  if (input) input.checked = true;
  // Merken, was zuletzt offen war (nur eine Bequemlichkeit; klappt es nicht, ist es egal)
  try { localStorage.setItem(SWITCH_STORAGE_KEY, kind); } catch { /* egal */ }
}

kindSwitch.addEventListener('change', (event) => showKind(event.target.value));

// ---------- Start ----------

const refreshers = Object.keys(KINDS).map((kind) => setupKind(kind));
const refreshAll = () => Promise.all(refreshers.map((refresh) => refresh())).catch(() => {});

// Nach Import oder Wiederherstellen (js/import.js, js/backup.js) alles neu laden
window.addEventListener('entries-changed', refreshAll);

let startKind = 'anesthesia';
try { startKind = localStorage.getItem(SWITCH_STORAGE_KEY) || 'anesthesia'; } catch { /* egal */ }
showKind(KIND_PANELS.includes(startKind) ? startKind : 'anesthesia');
refreshAll();
