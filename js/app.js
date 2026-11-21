// app.js – steuert die Oberfläche: Reiter, Formular "Neue Narkose" und die Liste.
// Das Speichern selbst erledigt db.js.

import {
  saveAnesthesia, getAnesthesia, listAnesthesias, deleteAnesthesia, requestPersistentStorage,
} from './db.js';
import {
  SPECIALTIES, ASA_CLASSES, GENERAL_ANESTHESIA, NEURAXIAL, BLOCKS,
  AIRWAY_TECHNIQUES, LOCATIONS, MAX_BLOCKS,
} from './options.js';
import { refreshOverview } from './overview.js';

// ---------- Reiter (wie in Schritt 1) ----------

const tabButtons = document.querySelectorAll('.tab-bar button');
const tabPanels = document.querySelectorAll('.tab-panel');

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const targetId = button.dataset.tab;
    tabPanels.forEach((panel) => {
      panel.hidden = panel.id !== targetId;
    });
    tabButtons.forEach((other) => {
      if (other === button) other.setAttribute('aria-current', 'page');
      else other.removeAttribute('aria-current');
    });
    // Übersicht beim Öffnen neu berechnen, damit neue Fälle sofort mitzählen.
    if (targetId === 'tab-overview') refreshOverview();
  });
});

// ---------- Elemente auf der Seite ----------

const form = document.getElementById('anesthesia-form');
const formTitle = document.getElementById('form-title');
const saveButton = document.getElementById('save-button');
const cancelEditButton = document.getElementById('cancel-edit');
const formError = document.getElementById('form-error');
const entryList = document.getElementById('entry-list');
const emptyList = document.getElementById('empty-list');
const entryCount = document.getElementById('entry-count');
const procedureSuggestions = document.getElementById('procedure-suggestions');
const toast = document.getElementById('toast');

// Welche Auswahlgruppe welche Optionen hat.
// "deselectable": ein zweites Tippen auf den gewählten Chip hebt die Auswahl wieder auf.
const GROUPS = {
  general: { options: GENERAL_ANESTHESIA, defaultValue: 'keine' },
  neuraxial: { options: NEURAXIAL, defaultValue: 'keine' },
  blocks: { options: BLOCKS },
  airway: { options: AIRWAY_TECHNIQUES },
  specialty: { options: SPECIALTIES, deselectable: true },
  asa: { options: ASA_CLASSES, deselectable: true },
  setting: { options: ['stationär', 'ambulant'], defaultValue: 'stationär' },
  location: { options: LOCATIONS, deselectable: true },
};

// Einzelne Ja/Nein-Schalter.
const TOGGLES = ['emergency', 'sedation', 'ultrasound', 'cvc', 'arterial', 'childUnder5'];

// Merkt sich, ob wir gerade einen bestehenden Eintrag bearbeiten (dann steht hier seine id).
let editingId = null;
let editingCreatedAt = null;

// ---------- Hilfsfunktionen ----------

// Heutiges Datum als Text "JJJJ-MM-TT" (das Format, das das Datumsfeld erwartet).
function todayString() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "2026-11-21" -> "21.11.2026"
function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2200);
}

// Baut einen einzelnen Chip: ein verstecktes Auswahlfeld plus sichtbare Beschriftung.
function createChip(type, name, value, label) {
  const chip = document.createElement('label');
  chip.className = 'chip';
  const input = document.createElement('input');
  input.type = type;
  input.name = name;
  input.value = value;
  const text = document.createElement('span');
  text.textContent = label;
  chip.append(input, text);
  return chip;
}

// Füllt eine Gruppe (z. B. "Fachgebiet") mit ihren Chips.
function renderGroup(name, options) {
  const container = form.querySelector(`[data-group="${name}"]`);
  const type = container.dataset.type;
  container.replaceChildren(...options.map((option) => createChip(type, name, option, option)));
}

// Für Blöcke und Orte: feste Liste + alles, was in alten Einträgen schon mal vorkam.
function mergeOptions(defaults, usedValues) {
  const extras = [...new Set(usedValues)]
    .filter((value) => value && !defaults.includes(value))
    .sort((a, b) => a.localeCompare(b, 'de'));
  return [...defaults, ...extras];
}

function checkedValues(name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function setChecked(name, values) {
  form.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = values.includes(input.value);
  });
}

// ---------- Formular aufbauen ----------

function renderToggles() {
  TOGGLES.forEach((name) => {
    const container = form.querySelector(`[data-toggle="${name}"]`);
    container.replaceChildren(createChip('checkbox', name, 'ja', container.dataset.label));
  });
}

// Baut die Chip-Gruppen neu auf. Blöcke und Orte bekommen auch selbst ergänzte Werte.
function renderGroups(entries) {
  for (const [name, group] of Object.entries(GROUPS)) {
    let options = group.options;
    if (name === 'blocks') {
      options = mergeOptions(BLOCKS, entries.flatMap((e) => [e.block1, e.block2]));
    } else if (name === 'location') {
      options = mergeOptions(LOCATIONS, entries.map((e) => e.location));
    }
    renderGroup(name, options);
  }
}

// Vorschläge für das Feld "Eingriff" aus bisherigen Einträgen.
function renderProcedureSuggestions(entries) {
  const procedures = [...new Set(entries.map((e) => e.procedure).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'de'));
  procedureSuggestions.replaceChildren(...procedures.map((p) => {
    const option = document.createElement('option');
    option.value = p;
    return option;
  }));
}

// Setzt das Formular auf "leer" zurück. keep = Werte, die stehen bleiben sollen.
function resetForm(keep = {}) {
  form.reset();
  for (const [name, group] of Object.entries(GROUPS)) {
    setChecked(name, group.defaultValue ? [group.defaultValue] : []);
  }
  form.elements.date.value = keep.date || todayString();
  if (keep.location) setChecked('location', [keep.location]);
  editingId = null;
  editingCreatedAt = null;
  formTitle.textContent = 'Neue Narkose';
  saveButton.textContent = 'Speichern';
  cancelEditButton.hidden = true;
  formError.hidden = true;
}

// Füllt das Formular mit einem gespeicherten Eintrag (zum Bearbeiten).
function fillForm(entry) {
  resetForm();
  form.elements.date.value = entry.date;
  setChecked('general', [entry.general]);
  setChecked('neuraxial', [entry.neuraxial]);
  setChecked('blocks', [entry.block1, entry.block2].filter(Boolean));
  setChecked('airway', entry.airway || []);
  setChecked('specialty', entry.specialty ? [entry.specialty] : []);
  setChecked('asa', entry.asa ? [String(entry.asa)] : []);
  setChecked('setting', [entry.setting]);
  setChecked('location', entry.location ? [entry.location] : []);
  TOGGLES.forEach((name) => setChecked(name, entry[name] ? ['ja'] : []));
  form.elements.procedure.value = entry.procedure || '';
  form.elements.note.value = entry.note || '';
  editingId = entry.id;
  editingCreatedAt = entry.createdAt;
  formTitle.textContent = 'Narkose bearbeiten';
  saveButton.textContent = 'Änderung speichern';
  cancelEditButton.hidden = false;
}

// Liest das Formular aus und macht daraus einen Eintrag (ein JavaScript-Objekt).
function readForm() {
  const blocks = checkedValues('blocks');
  const asa = checkedValues('asa')[0];
  const entry = {
    date: form.elements.date.value,
    procedure: form.elements.procedure.value.trim(),
    specialty: checkedValues('specialty')[0] || '',
    asa: asa ? Number(asa) : null,
    general: checkedValues('general')[0] || 'keine',
    neuraxial: checkedValues('neuraxial')[0] || 'keine',
    block1: blocks[0] || '',
    block2: blocks[1] || '',
    airway: checkedValues('airway'),
    setting: checkedValues('setting')[0] || 'stationär',
    location: checkedValues('location')[0] || '',
    note: form.elements.note.value.trim(),
  };
  TOGGLES.forEach((name) => { entry[name] = checkedValues(name).length > 0; });
  if (editingId) {
    entry.id = editingId;
    entry.createdAt = editingCreatedAt;
  }
  return entry;
}

// Prüft, ob der Eintrag sinnvoll ist. Gibt eine Fehlermeldung zurück oder null.
function validate(entry) {
  if (!entry.date) return 'Bitte ein Datum angeben.';
  // ZVK/Arterie allein ist auch erlaubt (z. B. importierte Einzelmaßnahmen, bis es Schritt 6 "Maßnahmen" gibt).
  const hasProcedure = entry.general !== 'keine' || entry.neuraxial !== 'keine'
    || entry.block1 || entry.sedation || entry.cvc || entry.arterial;
  if (!hasProcedure) {
    return 'Bitte mindestens ein Verfahren wählen: Allgemeinanästhesie, rückenmarksnah, Block, Sedierung, ZVK oder Arterie.';
  }
  return null;
}

// ---------- Liste der Einträge ----------

// Kurzbeschreibung der Verfahren, z. B. "ITN + PDK thorakal + TAP"
function describeProcedures(entry) {
  const parts = [];
  if (entry.general !== 'keine') parts.push(entry.general);
  if (entry.neuraxial !== 'keine') parts.push(entry.neuraxial);
  if (entry.block1) parts.push(entry.block1);
  if (entry.block2) parts.push(entry.block2);
  if (entry.sedation) parts.push('Sedierung');
  // nur ZVK/Arterie ohne Narkose: dann das als Überschrift zeigen
  if (!parts.length) parts.push(...describeExtras(entry).filter((x) => x === 'ZVK' || x === 'Arterie'));
  return parts.join(' + ');
}

function describeDetails(entry) {
  const parts = [];
  if (entry.specialty) parts.push(entry.specialty);
  if (entry.asa) parts.push(`ASA ${entry.asa}`);
  if (entry.setting === 'ambulant') parts.push('ambulant');
  if (entry.location) parts.push(entry.location);
  if (entry.procedure) parts.push(entry.procedure);
  return parts.join(' · ');
}

function describeExtras(entry) {
  const extras = [...(entry.airway || [])];
  if (entry.ultrasound) extras.push('Sono');
  if (entry.cvc) extras.push('ZVK');
  if (entry.arterial) extras.push('Arterie');
  if (entry.childUnder5) extras.push('Kind < 5 J.');
  if (entry.emergency) extras.push('Notfall');
  return extras;
}

function renderList(entries) {
  emptyList.hidden = entries.length > 0;
  entryCount.textContent = entries.length ? `(${entries.length})` : '';

  // Wir bauen die Listeneinträge mit textContent statt innerHTML:
  // so kann ein Text aus einer Notiz nie versehentlich als Code ausgeführt werden.
  entryList.replaceChildren(...entries.map((entry) => {
    const item = document.createElement('li');
    item.className = 'entry';

    const head = document.createElement('div');
    head.className = 'entry-head';
    const date = document.createElement('span');
    date.className = 'entry-date';
    date.textContent = formatDate(entry.date);
    const procedures = document.createElement('strong');
    procedures.textContent = describeProcedures(entry);
    head.append(date, procedures);

    const details = document.createElement('div');
    details.className = 'entry-details';
    details.textContent = describeDetails(entry);

    const tags = document.createElement('div');
    tags.className = 'entry-tags';
    describeExtras(entry).forEach((extra) => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = extra;
      tags.append(tag);
    });

    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = 'Bearbeiten';
    editButton.dataset.action = 'edit';
    editButton.dataset.id = entry.id;
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Löschen';
    deleteButton.className = 'danger';
    deleteButton.dataset.action = 'delete';
    deleteButton.dataset.id = entry.id;
    actions.append(editButton, deleteButton);

    item.append(head, details);
    if (tags.childElementCount) item.append(tags);
    if (entry.note) {
      const note = document.createElement('div');
      note.className = 'entry-note';
      note.textContent = entry.note;
      item.append(note);
    }
    item.append(actions);
    return item;
  }));
}

// Lädt alle Einträge neu und baut Liste, Chips und Vorschläge auf.
async function refresh(keep) {
  const entries = await listAnesthesias();
  renderGroups(entries);
  renderProcedureSuggestions(entries);
  renderList(entries);
  resetForm(keep);
}

// ---------- Reaktionen auf Tippen ----------

// Merkt sich pro Gruppe, welcher Chip vor dem Tippen gewählt war (für "nochmal tippen = abwählen").
const checkedBeforeClick = {};
form.addEventListener('pointerdown', (event) => {
  const input = event.target.closest('.chip')?.querySelector('input[type="radio"]');
  if (input) checkedBeforeClick[input.name] = input.checked ? input.value : null;
});

form.addEventListener('click', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'radio') return;
  const group = GROUPS[input.name];
  if (group?.deselectable && checkedBeforeClick[input.name] === input.value) {
    input.checked = false;
  }
  checkedBeforeClick[input.name] = null;
});

form.addEventListener('change', (event) => {
  const input = event.target;
  formError.hidden = true; // alte Fehlermeldung ausblenden, sobald man etwas ändert
  if (input.name === 'blocks' && input.checked) {
    // Höchstens 2 Blöcke
    if (checkedValues('blocks').length > MAX_BLOCKS) {
      input.checked = false;
      showToast(`Höchstens ${MAX_BLOCKS} Blöcke pro Eintrag.`);
      return;
    }
    // Blöcke werden meist mit Ultraschall gemacht: Sono automatisch anhaken (abwählbar).
    setChecked('ultrasound', ['ja']);
  }
});

// "Anderer Block" / "Anderer Ort" hinzufügen
function addOwnOption(groupName) {
  const field = form.querySelector(`[data-add-for="${groupName}"]`);
  const value = field.value.trim();
  if (!value) return;
  const container = form.querySelector(`[data-group="${groupName}"]`);
  let input = [...container.querySelectorAll('input')].find((i) => i.value === value);
  if (!input) {
    const chip = createChip(container.dataset.type, groupName, value, value);
    container.append(chip);
    input = chip.querySelector('input');
  }
  if (groupName === 'blocks' && !input.checked && checkedValues('blocks').length >= MAX_BLOCKS) {
    showToast(`Höchstens ${MAX_BLOCKS} Blöcke pro Eintrag.`);
  } else {
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  field.value = '';
}

form.querySelectorAll('[data-add-button]').forEach((button) => {
  button.addEventListener('click', () => addOwnOption(button.dataset.addButton));
});
form.querySelectorAll('[data-add-for]').forEach((field) => {
  // Enter im Textfeld soll hinzufügen, nicht das ganze Formular abschicken.
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addOwnOption(field.dataset.addFor);
    }
  });
});

// Speichern
form.addEventListener('submit', async (event) => {
  event.preventDefault(); // verhindert, dass der Browser die Seite neu lädt
  const entry = readForm();
  const error = validate(entry);
  if (error) {
    formError.textContent = error;
    formError.hidden = false;
    formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const wasEditing = Boolean(editingId);
  try {
    await saveAnesthesia(entry);
  } catch (e) {
    formError.textContent = `Speichern hat nicht geklappt: ${e.message}`;
    formError.hidden = false;
    return;
  }
  requestPersistentStorage();
  // Bei einer neuen Narkose bleiben Datum und Ort stehen (praktisch für mehrere Fälle am selben Tag).
  await refresh(wasEditing ? {} : { date: entry.date, location: entry.location });
  showToast(wasEditing ? 'Änderung gespeichert' : 'Narkose gespeichert');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

cancelEditButton.addEventListener('click', () => resetForm());

// Bearbeiten / Löschen in der Liste
entryList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const entry = await getAnesthesia(button.dataset.id);
  if (!entry) return;

  if (button.dataset.action === 'edit') {
    fillForm(entry);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (button.dataset.action === 'delete') {
    const question = `Narkose vom ${formatDate(entry.date)} (${describeProcedures(entry)}) wirklich löschen?`;
    if (!confirm(question)) return;
    await deleteAnesthesia(entry.id);
    if (editingId === entry.id) resetForm();
    const entries = await listAnesthesias();
    renderList(entries);
    renderProcedureSuggestions(entries);
    showToast('Eintrag gelöscht');
  }
});

// Nach einem Import (js/import.js) Liste und Übersicht neu laden.
window.addEventListener('entries-changed', () => {
  refresh().catch(() => {});
  refreshOverview().catch(() => {});
});

// ---------- Start ----------

renderToggles();
// Übersicht und Einstellungen einmal am Anfang laden (auch für den Schalter im Profil).
refreshOverview().catch(() => {});
refresh().catch((e) => {
  formError.textContent = `Die Datenbank konnte nicht geöffnet werden: ${e.message}`;
  formError.hidden = false;
});
