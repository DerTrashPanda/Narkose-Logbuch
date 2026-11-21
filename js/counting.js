// counting.js – die Zählregeln: Welche Narkose zählt in welcher WBO-Kategorie?
//
// Diese Datei rechnet nur. Sie zeigt nichts an und speichert nichts.
// So kann man die Regeln an einer Stelle lesen und ändern.
//
// Richtzahlen: geprüft am 21.11.2026 gegen die "Richtlinien über den Inhalt der Weiterbildung"
// der LÄK Rheinland-Pfalz (3. Änderung vom 06.11.2024), Facharzt Anästhesiologie, S. 19–23.
// Alle alten Zahlen stimmen mit dem eLogbuch-Export vom 19.11.2026 überein;
// neu aus der RLP-Richtlinie: Organtransplantationen, Farbduplex Leber/Niere, POC-Gerinnung.
// Notarzteinsätze (50, davon bis zu 25 Simulation): WBO RLP, Zusatz-Weiterbildung Notfallmedizin.

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
//   measure  – Funktion: wie viel zählt eine Maßnahme hier? (fehlt = 0)
//   icu      – Funktion: wie viel zählt ein Intensiv-Fall hier? (fehlt = 0)
//   emergency – Funktion: wie viel zählt ein Notarzteinsatz hier? (fehlt = 0)
//   simLimit – höchstens so viel Prozent darf aus Simulation stammen (Hinweis, zählt trotzdem)
//   simMax   – höchstens so viele Simulationen werden angerechnet (der Rest zählt nicht)
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
    // Neu nach Richtlinie LÄK RLP: "Anästhesieverfahren bei Organtransplantationen" (20)
    id: 'transplant', label: 'Organtransplantationen', target: 20,
    count: (e) => (e.transplant ? 1 : 0),
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
    measure: (m) => (m.type === 'Fiberoptische Intubation' ? 1 : 0),
  },
  {
    id: 'video', label: 'Videolaryngoskopie', target: 20,
    count: (e) => ((e.airway || []).includes('Videolaryngoskopie') ? 1 : 0),
    measure: (m) => (m.type === 'Videolaryngoskopie' ? 1 : 0),
  },
  {
    id: 'ultrasound', label: 'Ultraschallverfahren', target: 50,
    count: (e) => (e.ultrasound ? 1 : 0),
    // Maßnahme mit Häkchen "mit Ultraschall" (z. B. ZVK unter Sono) oder sono-gesteuerte Punktion
    measure: (m) => (m.ultrasound || m.type === 'Sono-gesteuerte Punktion' ? 1 : 0),
  },
  {
    id: 'cvc', label: 'ZVK', target: 30,
    count: (e) => (e.cvc ? 1 : 0),
    measure: (m) => (m.type === 'ZVK' ? 1 : 0),
  },
  {
    id: 'arterial', label: 'Arterie', target: 30,
    count: (e) => (e.arterial ? 1 : 0),
    measure: (m) => (m.type === 'Arterie' ? 1 : 0),
  },

  { group: 'Maßnahmen' },
  {
    id: 'pleura', label: 'Pleurapunktion/-drainage', target: 5,
    count: () => 0,
    measure: (m) => (m.type === 'Pleurapunktion' || m.type === 'Pleuradrainage' ? 1 : 0),
  },
  {
    id: 'bronchoscopy', label: 'Tracheo-/Bronchoskopien', target: 25,
    count: () => 0,
    measure: (m) => (m.type === 'Bronchoskopie' || m.type === 'Tracheoskopie' ? 1 : 0),
  },
  {
    id: 'incidentTraining', label: 'Zwischenfalltraining', target: 5,
    count: () => 0,
    measure: (m) => (m.type === 'Zwischenfalltraining' ? 1 : 0),
  },
  {
    // Neu nach Richtlinie LÄK RLP: "Farbkodierte Duplexsonographie Leber oder Niere" (25)
    id: 'duplex', label: 'Farbduplex Leber/Niere', target: 25,
    count: () => 0,
    measure: (m) => (m.type === 'Farbduplex Leber/Niere' ? 1 : 0),
  },
  {
    // Neu nach Richtlinie LÄK RLP: "Gerinnungsdiagnostik mittels POC (viskoelastische Testmethoden)" (50)
    id: 'pocCoagulation', label: 'POC-Gerinnungsdiagnostik', target: 50,
    count: () => 0,
    measure: (m) => (m.type === 'POC-Gerinnung' ? 1 : 0),
  },

  { group: 'Intensivmedizin' },
  {
    id: 'icuOrgans', label: 'ITS: ≥ 2 Organsysteme gestört', target: 100,
    count: () => 0,
    icu: (i) => (i.organs2 ? 1 : 0),
  },
  {
    id: 'ventilation', label: 'Beatmung/Weaning', target: 50,
    count: () => 0,
    icu: (i) => (i.ventilation ? 1 : 0),
  },

  { group: 'Zusatz-Weiterbildung Notfallmedizin' },
  {
    id: 'emergencyPhysician', label: 'Notarzteinsätze', target: 50, simMax: 25,
    count: () => 0,
    emergency: () => 1,
  },
];

// Nur die echten Kategorien (ohne Zwischenüberschriften).
export const COUNTABLE = CATEGORIES.filter((c) => c.id);

export function categoryLabel(id) {
  return COUNTABLE.find((c) => c.id === id)?.label || id;
}

// Ist ein Eintrag eine Simulation? (Maßnahme mit Häkchen oder Notarzt-"Einsatz" im Simulationskurs)
function isSimulation(record) {
  return Boolean(record.simulation) || record.vehicle === 'Simulation';
}

// Rechnet für jede Kategorie aus: wie viel aus Einzelfällen, wie viel aus Nachträgen.
// records = { measures, icu, emergencies } (Schritt 6); fehlt etwas, zählt es als leer.
// Ergebnis: { total: { fromEntries: 34, fromSupplements: 5, sum: 39, simulation: 0, simIgnored: 0 }, ... }
//   simulation = davon aus Simulation (angerechnet), simIgnored = Simulationen über der Höchstzahl
export function computeProgress(entries, supplements, settings, records = {}) {
  const result = {};
  for (const category of COUNTABLE) {
    result[category.id] = { fromEntries: 0, fromSupplements: 0, sum: 0, simulation: 0, simIgnored: 0 };
  }
  for (const entry of entries) {
    for (const category of COUNTABLE) {
      result[category.id].fromEntries += category.count(entry, settings);
    }
  }
  // Maßnahmen, Intensiv, Notarzt: jede Kategorie sagt selbst, ob und wie viel sie zählt.
  const sources = [
    ['measure', records.measures || []],
    ['icu', records.icu || []],
    ['emergency', records.emergencies || []],
  ];
  for (const [counterName, list] of sources) {
    for (const record of list) {
      for (const category of COUNTABLE) {
        const counter = category[counterName];
        const amount = counter ? counter(record) : 0;
        if (!amount) continue;
        const row = result[category.id];
        if (isSimulation(record)) {
          // Höchstzahl für Simulation (Notarzt: höchstens 25): darüber hinaus zählt es nicht.
          if (category.simMax !== undefined && row.simulation + amount > category.simMax) {
            const allowed = Math.max(category.simMax - row.simulation, 0);
            row.simIgnored += amount - allowed;
            row.simulation += allowed;
            row.fromEntries += allowed;
            continue;
          }
          row.simulation += amount;
        }
        row.fromEntries += amount;
      }
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
