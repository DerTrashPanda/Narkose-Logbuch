// import-mapping.js – übersetzt Zeilen der alten Excel-Tabelle in Narkose-Einträge der App.
//
// Diese Datei rechnet nur (sie zeigt nichts an und speichert nichts).
// Wer eine Abkürzung ergänzen will (z. B. einen neuen Block), ändert TOKENS weiter unten.

// ---------- 1. Welche Spalte wird zu welchem App-Feld? ----------

// Jede Spalte der CSV-Datei bekommt genau ein Ziel. "headers" sind Spaltenüberschriften,
// die wir automatisch erkennen (klein geschrieben, ohne Leerzeichen am Rand).
export const TARGETS = [
  { id: 'ignore', label: 'nicht importieren' },
  { id: 'date', label: 'Datum', headers: ['datum', 'date'] },
  { id: 'procedure', label: 'Eingriff', headers: ['eingriff', 'op', 'operation'] },
  { id: 'asa', label: 'ASA', headers: ['asa'] },
  { id: 'setting', label: 'ambulant/stationär', headers: ['ambulant/stationär', 'ambulant', 'stationär'] },
  { id: 'childUnder5', label: 'Kind < 5 J. (ja/nein)', headers: ['unter 5 jahre?', 'unter 5 jahre', 'kind < 5 j.', 'kind < 5'] },
  { id: 'ageYears', label: 'Alter in Jahren (wird nur zu „Kind < 5 J.“)', headers: ['alter', 'alter (jahre)'] },
  { id: 'specialty', label: 'Fachgebiet', headers: ['disziplin', 'fachgebiet'] },
  { id: 'baseProcedure', label: 'Grundverfahren (nur als Ersatz, wenn „Verfahren“ leer)', headers: ['anästhesieverfahren', 'grundverfahren'] },
  { id: 'procedures', label: 'Verfahren (ITN, Spinal, Blöcke, ZVK …)', headers: ['verfahren 1', 'verfahren 2', 'verfahren 3', 'verfahren 4', 'verfahren'] },
  { id: 'note', label: 'Notiz', headers: ['sonstiges', 'notiz', 'bemerkung'] },
];

// Spalten, die nie importiert werden dürfen (Datenschutz). Man kann sie auch nicht umstellen.
const FORBIDDEN_HEADER = /fall\s*-?\s*(nr|nummer)|fallnummer|name|geburt|geb\.?\s*dat|adresse|stra(ß|ss)e|wohnort|telefon|versicherten|patienten\s*-?\s*(nr|nummer|id)|\bpid\b/i;

export function isForbiddenHeader(header) {
  return FORBIDDEN_HEADER.test(header);
}

function clean(text) {
  return String(text ?? '').trim();
}

// Schlägt für jede Spaltenüberschrift ein Ziel vor. Ergebnis z. B. ['date', 'forbidden', 'procedure', …]
export function suggestMapping(headers) {
  return headers.map((header) => {
    if (isForbiddenHeader(header)) return 'forbidden';
    const key = clean(header).toLowerCase();
    const target = TARGETS.find((t) => t.headers?.includes(key));
    return target ? target.id : 'ignore';
  });
}

// ---------- 2. Werte übersetzen ----------

// Datum in "JJJJ-MM-TT". Versteht 24.03.2026, 24.3.26, 2026-03-24 und Excel-Zahlen (z. B. 46105).
export function parseDate(text) {
  const value = clean(text);
  let match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (match) {
    const [, d, m, yRaw] = match;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return validIso(y, m, d);
  }
  match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return validIso(match[1], match[2], match[3]);
  if (/^\d{5}$/.test(value)) {
    // Excel zählt Tage ab dem 30.12.1899
    const date = new Date(Date.UTC(1899, 11, 30) + Number(value) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  return null;
}

function validIso(y, m, d) {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}

const SPECIALTY_MAP = {
  abdominell: 'Abdominell',
  thorax: 'Thorax',
  thorakal: 'Thorax',
  'kopf-hals': 'Kopf-Hals',
  'kopf hals': 'Kopf-Hals',
  intrakraniell: 'Intrakraniell',
  geburtshilfe: 'Geburtshilfe',
  sectio: 'Sectio',
  sonstige: 'Sonstige',
  sonstiges: 'Sonstige',
};

// Die Abkürzungen aus der alten Tabelle (klein geschrieben, ohne Leerzeichen am Rand).
// kind: general = Allgemeinanästhesie, neuraxial = rückenmarksnah, block = peripherer Block,
//       sedation, cvc = ZVK, arterial = Arterie, airway = Atemweg-Technik.
// warn: dieser Wert ist nicht ganz eindeutig, die Vorschau zeigt einen Hinweis.
const TOKENS = {
  itn: { kind: 'general', value: 'ITN' },
  intubation: { kind: 'general', value: 'ITN' },
  rsi: { kind: 'general', value: 'ITN (RSI)' },
  'itn (rsi)': { kind: 'general', value: 'ITN (RSI)' },
  lama: { kind: 'general', value: 'LAMA' },
  larynxmaske: { kind: 'general', value: 'LAMA' },
  maske: { kind: 'general', value: 'Maske' },
  maskennarkose: { kind: 'general', value: 'Maske' },
  dlt: { kind: 'general', value: 'DLT' },
  'kam intubiert von intensiv': { kind: 'general', value: 'ITN', warn: '„kam intubiert“ als ITN gezählt' },

  spinal: { kind: 'neuraxial', value: 'Spinal' },
  spinale: { kind: 'neuraxial', value: 'Spinal' },
  spinalanästhesie: { kind: 'neuraxial', value: 'Spinal' },
  spa: { kind: 'neuraxial', value: 'Spinal' },
  'pdk lumbal': { kind: 'neuraxial', value: 'PDK lumbal' },
  'pdk thorakal': { kind: 'neuraxial', value: 'PDK thorakal' },
  pdk: { kind: 'neuraxial', value: 'PDK ?' }, // Höhe wird unten aus dem Fachgebiet abgeleitet
  pda: { kind: 'neuraxial', value: 'PDK ?' },
  cse: { kind: 'neuraxial', value: 'CSE' },
  kaudal: { kind: 'neuraxial', value: 'Kaudal' },
  kaudalblock: { kind: 'neuraxial', value: 'Kaudal' },
  kb: { kind: 'neuraxial', value: 'Kaudal' },

  adduktorenblock: { kind: 'block', value: 'Adduktorenkanal' },
  adduktorenkanal: { kind: 'block', value: 'Adduktorenkanal' },
  addbl: { kind: 'block', value: 'Adduktorenkanal' },
  addblock: { kind: 'block', value: 'Adduktorenkanal' },
  'add block': { kind: 'block', value: 'Adduktorenkanal' },
  'add block (ktep)': { kind: 'block', value: 'Adduktorenkanal' },
  add: { kind: 'block', value: 'Adduktorenkanal' },
  fib: { kind: 'block', value: 'FIB' },
  tap: { kind: 'block', value: 'TAP' },
  esb: { kind: 'block', value: 'ESB' },
  'erector spinae block': { kind: 'block', value: 'ESB' },
  dib: { kind: 'block', value: 'DIB' },
  nfk: { kind: 'block', value: 'NFK' },
  femoraliskath: { kind: 'block', value: 'NFK' },
  femoraliskatheter: { kind: 'block', value: 'NFK' },
  nik: { kind: 'block', value: 'NIK' },
  pwb: { kind: 'block', value: 'PWB' },
  scp: { kind: 'block', value: 'Supraklavikulär' },
  'plexus supraclaviculär': { kind: 'block', value: 'Supraklavikulär' },
  'supraclaviculärer plexus': { kind: 'block', value: 'Supraklavikulär' },
  supraklavikulär: { kind: 'block', value: 'Supraklavikulär' },
  axplex: { kind: 'block', value: 'Axillär' },
  axillär: { kind: 'block', value: 'Axillär' },
  interskalenär: { kind: 'block', value: 'Interskalenär' },
  // Allgemeine Namen ohne genaue Art: bleiben so als Block (zählen als periphere RA).
  isk: { kind: 'block', value: 'Interskalenär' }, // ISK = Interskalenärkatheter (vom Nutzer bestätigt)
  faszienblock: { kind: 'block', value: 'Faszienblock' },
  plexusblock: { kind: 'block', value: 'Plexusblock' },

  sedierung: { kind: 'sedation' },
  standby: { kind: 'sedation' },
  zvk: { kind: 'cvc' },
  'zvk ?': { kind: 'cvc', warn: '„ZVK ?“ als ZVK gezählt' },
  shaldon: { kind: 'cvc', warn: 'Shaldon-Katheter als ZVK gezählt' },
  arterie: { kind: 'arterial' },
  art: { kind: 'arterial' },
  fiberoptik: { kind: 'airway', value: 'Fiberoptik' },
  'fiberoptische intubation': { kind: 'airway', value: 'Fiberoptik' },
  videolaryngoskopie: { kind: 'airway', value: 'Videolaryngoskopie' },
  'videoassistierte intubation': { kind: 'airway', value: 'Videolaryngoskopie' },
};

// Ersatz, wenn alle "Verfahren"-Spalten leer sind, aber das Grundverfahren ausgefüllt ist.
const BASE_PROCEDURE_FALLBACK = {
  allgemeinanästhesie: { kind: 'general', value: 'ITN' },
  'regional rückenmarksnah': { kind: 'neuraxial', value: 'Spinal' },
  sedierung: { kind: 'sedation' },
  standby: { kind: 'sedation' },
};

// ---------- 3. Eine Zeile übersetzen ----------

// cells   = Zellen der Zeile, mapping = Ziel je Spalte (aus suggestMapping, ggf. geändert),
// options = { sectioFromProcedure: true } → Eingriff "Sectio" setzt das Fachgebiet auf "Sectio".
// Ergebnis: { entry, warnings: [...], skipReason } – skipReason gesetzt = Zeile wird nicht importiert.
// Steht zusätzlich measures: [...] darin, wird die Zeile als Maßnahme(n) statt als Narkose importiert.
export function convertRow(cells, mapping, options = {}) {
  const warnings = [];
  const valuesFor = (target) => mapping
    .map((t, index) => (t === target ? clean(cells[index]) : ''))
    .filter(Boolean);
  const first = (target) => valuesFor(target)[0] || '';

  const entry = {
    date: null,
    procedure: first('procedure'),
    specialty: '',
    asa: null,
    general: 'keine',
    neuraxial: 'keine',
    block1: '',
    block2: '',
    airway: [],
    setting: 'stationär',
    location: '',
    note: valuesFor('note').join(' · '),
    emergency: false,
    sedation: false,
    ultrasound: false,
    cvc: false,
    arterial: false,
    childUnder5: false,
  };

  // Datum
  const dateText = first('date');
  entry.date = parseDate(dateText);
  if (!entry.date) {
    return { entry, warnings, skipReason: dateText ? `Datum „${dateText}“ nicht lesbar` : 'kein Datum' };
  }

  // ASA
  const asaText = first('asa');
  if (asaText) {
    const asa = Number(asaText.replace(/^asa\s*/i, ''));
    if (Number.isInteger(asa) && asa >= 1 && asa <= 6) entry.asa = asa;
    else warnings.push(`ASA „${asaText}“ nicht erkannt`);
  }

  // ambulant / stationär
  const settingText = first('setting').toLowerCase();
  if (settingText === 'ambulant') entry.setting = 'ambulant';
  else if (settingText && settingText !== 'stationär') warnings.push(`„${first('setting')}“ als stationär übernommen`);

  // Kind < 5 Jahre (ja/nein) oder aus dem Alter – das Alter selbst wird NICHT gespeichert.
  const childText = first('childUnder5').toLowerCase();
  if (['ja', 'j', 'x', '1', 'true', 'wahr'].includes(childText)) entry.childUnder5 = true;
  const ageText = first('ageYears');
  if (ageText) {
    const age = Number(ageText.replace(',', '.'));
    if (Number.isFinite(age)) entry.childUnder5 = entry.childUnder5 || age < 5;
    else warnings.push('Alter nicht lesbar');
  }

  // Fachgebiet
  const specialtyText = first('specialty');
  if (specialtyText) {
    entry.specialty = SPECIALTY_MAP[specialtyText.toLowerCase()] || '';
    if (!entry.specialty) warnings.push(`Fachgebiet „${specialtyText}“ nicht erkannt`);
  }
  if (options.sectioFromProcedure && /sectio/i.test(entry.procedure)
      && ['', 'Geburtshilfe', 'Sonstige'].includes(entry.specialty)) {
    entry.specialty = 'Sectio';
  }

  // Verfahren
  const tokens = valuesFor('procedures');
  const baseText = first('baseProcedure');
  const base = BASE_PROCEDURE_FALLBACK[baseText.toLowerCase()];
  const blocks = [];
  const unknown = [];
  tokens.forEach((raw) => {
    const token = TOKENS[raw.toLowerCase()];
    if (!token) {
      unknown.push(raw);
      return;
    }
    if (token.warn) warnings.push(token.warn);
    applyToken(entry, token, raw, warnings, blocks);
  });

  // Blöcke: höchstens 2 im Datenmodell
  [entry.block1 = '', entry.block2 = ''] = blocks;
  if (blocks.length > 2) {
    warnings.push(`mehr als 2 Blöcke – ${blocks.slice(2).join(', ')} nur in der Notiz`);
    appendNote(entry, `weitere Blöcke: ${blocks.slice(2).join(', ')}`);
  }
  // Blöcke werden mit Ultraschall gemacht (wie im Formular: Sono automatisch an)
  if (blocks.length) entry.ultrasound = true;

  // PDK ohne Höhe: aus dem Fachgebiet ableiten
  if (entry.neuraxial === 'PDK ?') {
    entry.neuraxial = ['Abdominell', 'Thorax'].includes(entry.specialty) ? 'PDK thorakal' : 'PDK lumbal';
    warnings.push(`PDK ohne Höhe – als ${entry.neuraxial} angenommen`);
  }

  if (unknown.length) {
    warnings.push(`nicht erkannt, nur in der Notiz: ${unknown.join(', ')}`);
    appendNote(entry, `Import: ${unknown.join(', ')}`);
  }

  // Kein Narkoseverfahren in den "Verfahren"-Spalten? Dann hilft das Grundverfahren weiter.
  //   - Verfahren ganz leer: Grundverfahren übernehmen (auch Standby/Sedierung).
  //   - Nur ZVK/Arterie eingetragen (z. B. "Allgemeinanästhesie" + ZVK + Art): Allgemein-
  //     bzw. Regionalanästhesie übernehmen, aber NICHT Standby – eine ZVK-Anlage mit
  //     "Standby" wird eine Maßnahme (vom Nutzer so entschieden, 21.11.2026).
  if (!hasMainProcedure(entry) && base && (!tokens.length || base.kind !== 'sedation')) {
    warnings.push(`kein Narkoseverfahren in „Verfahren“ – aus „${baseText}“ als ${base.value || 'Sedierung'} angenommen`);
    applyToken(entry, base, baseText, warnings, []);
  }

  if (!hasMainProcedure(entry)) {
    if (entry.cvc || entry.arterial) {
      // Nur ZVK/Arterie ohne Narkose: wird als Maßnahme importiert (Schritt 6), nicht als Narkose.
      const note = [entry.procedure, entry.note].filter(Boolean).join(' · ');
      const measures = [];
      if (entry.cvc) measures.push('ZVK');
      if (entry.arterial) measures.push('Arterie');
      warnings.push(`ohne Narkose – wird als Maßnahme ${measures.join(' + ')} übernommen`);
      return {
        entry,
        measures: measures.map((type) => ({
          date: entry.date, type, simulation: false, ultrasound: false, location: '', note,
        })),
        warnings,
        skipReason: null,
      };
    }
    return { entry, warnings, skipReason: 'kein Verfahren eingetragen' };
  }
  return { entry, warnings, skipReason: null };
}

// Hat der Eintrag ein echtes Narkoseverfahren (Allgemein, rückenmarksnah, Block oder Sedierung)?
function hasMainProcedure(entry) {
  return entry.general !== 'keine' || entry.neuraxial !== 'keine' || Boolean(entry.block1) || entry.sedation;
}

function appendNote(entry, text) {
  entry.note = entry.note ? `${entry.note} · ${text}` : text;
}

const MORE_SPECIFIC_ITN = ['ITN (RSI)', 'DLT'];

// Trägt ein erkanntes Verfahren in den Eintrag ein.
function applyToken(entry, token, raw, warnings, blocks) {
  switch (token.kind) {
    case 'general':
      // RSI und DLT sind genauer als ITN: ITN + RSI in einer Zeile = ITN (RSI), ITN + DLT = DLT
      if (entry.general === 'keine' || (entry.general === 'ITN' && MORE_SPECIFIC_ITN.includes(token.value))) {
        entry.general = token.value;
      } else if (!(MORE_SPECIFIC_ITN.includes(entry.general) && token.value === 'ITN') && entry.general !== token.value) {
        warnings.push(`zwei Allgemeinanästhesien (${entry.general}, ${token.value}) – ${token.value} nur in der Notiz`);
        appendNote(entry, `auch ${raw}`);
      }
      break;
    case 'neuraxial':
      if (entry.neuraxial === 'keine') {
        entry.neuraxial = token.value;
      } else if (entry.neuraxial === 'CSE' && ['Spinal', 'PDK ?', 'PDK lumbal'].includes(token.value)) {
        // CSE enthält Spinal und PDK schon – nichts zu tun
      } else if (entry.neuraxial !== token.value) {
        warnings.push(`zwei rückenmarksnahe Verfahren (${entry.neuraxial}, ${raw}) – ${raw} nur in der Notiz`);
        appendNote(entry, `auch ${raw}`);
      }
      break;
    case 'block':
      if (!blocks.includes(token.value)) blocks.push(token.value);
      break;
    case 'airway':
      if (!entry.airway.includes(token.value)) entry.airway.push(token.value);
      break;
    case 'sedation':
      entry.sedation = true;
      break;
    case 'cvc':
      entry.cvc = true;
      break;
    case 'arterial':
      entry.arterial = true;
      break;
    default:
      break;
  }
}

// ---------- 4. Die ganze Datei ----------

// rows = alle Zeilen der CSV (erste Zeile = Überschriften).
// Ergebnis: { results: [{ line, entry, warnings, skipReason }], ... }
export function convertAll(rows, mapping, options) {
  return rows.slice(1).map((cells, index) => ({
    line: index + 2, // Zeilennummer wie in Excel (Zeile 1 = Überschrift)
    ...convertRow(cells, mapping, options),
  }));
}
