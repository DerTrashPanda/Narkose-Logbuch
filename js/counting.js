// counting.js – die Zählregeln: Welche Narkose zählt in welcher WBO-Kategorie?
//
// Diese Datei rechnet nur. Sie zeigt nichts an und speichert nichts.
// So kann man die Regeln an einer Stelle lesen und ändern.
//
// Richtzahlen: Startwerte aus dem eLogbuch-Export vom 19.11.2026 (WBO Baden-Württemberg 2022).
// Die Richtlinie der LÄK Rheinland-Pfalz ist noch nicht geprüft.

// Der Kaudalblock zählt als rückenmarksnah, auch wenn er als "Block" (Abkürzung KB) eingetragen wurde.
const CAUDAL_BLOCK_NAMES = ['KB', 'Kaudal', 'Kaudalblock'];

function blocksOf(entry) {
  return [entry.block1, entry.block2].filter(Boolean);
}

function isCaudalBlock(name) {
  return CAUDAL_BLOCK_NAMES.includes(name);
}

function hasGeneral(entry) {
  return entry.general && entry.general !== 'keine';
}

function hasNeuraxial(entry) {
  return (entry.neuraxial && entry.neuraxial !== 'keine') || blocksOf(entry).some(isCaudalBlock);
}

function peripheralBlocks(entry) {
  return blocksOf(entry).filter((name) => !isCaudalBlock(name));
}

// Wie viele "Anästhesieverfahren" ist dieser eine Patient wert?
// countSeparately = Einstellung "Allgemein + Regional zählen getrennt" (Standard: an).
export function countProcedures(entry, countSeparately) {
  // Jedes Verfahren einzeln: Allgemeinanästhesie, rückenmarksnah, jeder periphere Block.
  let count = 0;
  if (hasGeneral(entry)) count += 1;
  if (entry.neuraxial && entry.neuraxial !== 'keine') count += 1;
  count += blocksOf(entry).length; // Kaudalblock als Block eingetragen zählt hier auch mit
  // Sedierung/Standby zählt nur, wenn sonst kein Verfahren gemacht wurde.
  if (count === 0 && entry.sedation) count = 1;

  if (!countSeparately) return Math.min(count, 1); // Umschalter aus: 1 Patient = 1 Verfahren
  return count;
}

// Die Kategorien der Übersicht, in der Reihenfolge der Anzeige.
//   id       – fester interner Name (ändert sich nie, auch wenn die Beschriftung sich ändert)
//   label    – Text in der Übersicht
//   target   – Richtzahl
//   parent   – "davon"-Kategorie einer anderen (wird eingerückt angezeigt)
//   count    – Funktion: wie viel zählt eine Narkose hier? (0, 1, 2 …)
//   later    – Hinweis, falls die Einzelerfassung erst in einem späteren Schritt kommt
//   simLimit – höchstens so viel Prozent darf aus Simulation stammen (nur Hinweis)
export const CATEGORIES = [
  { group: 'Anästhesieverfahren' },
  {
    id: 'total', label: 'Anästhesieverfahren gesamt', target: 1800,
    count: (e, s) => countProcedures(e, s.countSeparately),
  },
  {
    id: 'abdominal', label: 'Abdominelle Eingriffe', target: 300, parent: 'total',
    count: (e) => (e.specialty === 'Abdominell' ? 1 : 0),
  },
  {
    id: 'asa3', label: 'ASA ≥ 3', target: 100, parent: 'total',
    count: (e) => (e.asa >= 3 ? 1 : 0),
  },

  { group: 'Spezielle Bereiche' },
  {
    id: 'intracranial', label: 'Intrakranielle Eingriffe', target: 25,
    count: (e) => (e.specialty === 'Intrakraniell' ? 1 : 0),
  },
  {
    id: 'thoracic', label: 'Intrathorakale Eingriffe', target: 25,
    count: (e) => (e.specialty === 'Thorax' ? 1 : 0),
  },
  {
    id: 'headNeck', label: 'Kopf-Hals', target: 100,
    count: (e) => (e.specialty === 'Kopf-Hals' ? 1 : 0),
  },
  {
    id: 'children', label: 'Kinder < 5 Jahre', target: 50,
    count: (e) => (e.childUnder5 ? 1 : 0),
  },
  {
    id: 'obstetrics', label: 'Geburtshilfe', target: 50,
    count: (e) => (e.specialty === 'Geburtshilfe' || e.specialty === 'Sectio' ? 1 : 0),
  },
  {
    id: 'sectio', label: 'Sectio', target: 25, parent: 'obstetrics',
    count: (e) => (e.specialty === 'Sectio' ? 1 : 0),
  },
  {
    id: 'outpatient', label: 'Ambulante Anästhesien', target: 50,
    count: (e) => (e.setting === 'ambulant' ? 1 : 0),
  },

  { group: 'Regionalanästhesie' },
  {
    id: 'neuraxial', label: 'Rückenmarksnah', target: 50,
    count: (e) => (hasNeuraxial(e) ? 1 : 0),
  },
  {
    id: 'peripheral', label: 'Periphere Blöcke', target: 50,
    count: (e) => peripheralBlocks(e).length,
  },

  { group: 'Atemweg und Techniken' },
  {
    id: 'fiberoptic', label: 'Fiberoptische Intubation', target: 25, simLimit: 50,
    count: (e) => ((e.airway || []).includes('Fiberoptik') ? 1 : 0),
  },
  {
    id: 'video', label: 'Videolaryngoskopie', target: 20,
    count: (e) => ((e.airway || []).includes('Videolaryngoskopie') ? 1 : 0),
  },
  {
    id: 'ultrasound', label: 'Ultraschallverfahren', target: 50,
    count: (e) => (e.ultrasound ? 1 : 0),
  },
  {
    id: 'cvc', label: 'ZVK', target: 30,
    count: (e) => (e.cvc ? 1 : 0),
  },
  {
    id: 'arterial', label: 'Arterie', target: 30,
    count: (e) => (e.arterial ? 1 : 0),
  },

  { group: 'Maßnahmen' },
  {
    id: 'pleura', label: 'Pleurapunktion/-drainage', target: 5,
    count: () => 0, later: 'Einzelerfassung kommt mit „Maßnahmen“.',
  },
  {
    id: 'bronchoscopy', label: 'Tracheo-/Bronchoskopien', target: 25,
    count: () => 0, later: 'Einzelerfassung kommt mit „Maßnahmen“.',
  },
  {
    id: 'incidentTraining', label: 'Zwischenfalltraining', target: 5,
    count: () => 0, later: 'Einzelerfassung kommt mit „Maßnahmen“.',
  },

  { group: 'Intensivmedizin' },
  {
    id: 'icuOrgans', label: 'ITS: ≥ 2 Organsysteme gestört', target: 100,
    count: () => 0, later: 'Einzelerfassung kommt mit „Intensiv“.',
  },
  {
    id: 'ventilation', label: 'Beatmung/Weaning', target: 50,
    count: () => 0, later: 'Einzelerfassung kommt mit „Intensiv“.',
  },

  { group: 'Zusatz-Weiterbildung Notfallmedizin' },
  {
    id: 'emergencyPhysician', label: 'Notarzteinsätze', target: 50,
    count: () => 0, later: 'Einzelerfassung kommt mit „Notarzt“. Höchstens 25 aus Simulation.',
  },
];

// Nur die echten Kategorien (ohne Zwischenüberschriften).
export const COUNTABLE = CATEGORIES.filter((c) => c.id);

export function categoryLabel(id) {
  return COUNTABLE.find((c) => c.id === id)?.label || id;
}

// Rechnet für jede Kategorie aus: wie viel aus Narkosen, wie viel aus Nachträgen.
// Ergebnis: { total: { fromEntries: 34, fromSupplements: 5, sum: 39 }, ... }
export function computeProgress(entries, supplements, settings) {
  const result = {};
  for (const category of COUNTABLE) {
    result[category.id] = { fromEntries: 0, fromSupplements: 0, sum: 0 };
  }
  for (const entry of entries) {
    for (const category of COUNTABLE) {
      result[category.id].fromEntries += category.count(entry, settings);
    }
  }
  for (const supplement of supplements) {
    const row = result[supplement.category];
    if (row) row.fromSupplements += supplement.amount;
  }
  for (const row of Object.values(result)) {
    row.sum = row.fromEntries + row.fromSupplements;
  }
  return result;
}
