// describe.js – wie ein Eintrag als Text aussieht (Überschrift, Details, Schildchen).
// Früher stand das doppelt in app.js und records.js. Jetzt braucht es vor allem der
// Reiter "Fälle" (js/cases.js), deshalb liegt es hier an einer Stelle.

// Die vier Arten von Einträgen. Der Schlüssel ist derselbe wie in db.js.
export const KIND_LABELS = {
  anesthesia: 'Narkose',
  measures: 'Maßnahme',
  icu: 'Intensiv',
  emergencies: 'Notarzt',
};

// "2026-11-21" -> "21.11.2026"
export function formatDate(isoDate) {
  const [y, m, d] = String(isoDate).split('-');
  return `${d}.${m}.${y}`;
}

// ---------- Narkose ----------

function anesthesiaExtras(entry) {
  const extras = [...(entry.airway || [])];
  if (entry.ultrasound) extras.push('Sono');
  if (entry.cvc) extras.push('ZVK');
  if (entry.arterial) extras.push('Arterie');
  if (entry.transplant) extras.push('Transplantation');
  if (entry.childUnder5) extras.push('Kind < 5 J.');
  if (entry.emergency) extras.push('Notfall');
  return extras;
}

// Kurzbeschreibung der Verfahren, z. B. "ITN + PDK thorakal + TAP"
export function describeProcedures(entry) {
  const parts = [];
  if (entry.general && entry.general !== 'keine') parts.push(entry.general);
  if (entry.neuraxial && entry.neuraxial !== 'keine') parts.push(entry.neuraxial);
  if (entry.block1) parts.push(entry.block1);
  if (entry.block2) parts.push(entry.block2);
  if (entry.sedation) parts.push('Sedierung');
  // nur ZVK/Arterie ohne Narkose: dann das als Überschrift zeigen
  if (!parts.length) parts.push(...anesthesiaExtras(entry).filter((x) => x === 'ZVK' || x === 'Arterie'));
  return parts.join(' + ');
}

// ---------- Bauanleitung pro Art: Überschrift, Details, Schildchen ----------

const DESCRIBERS = {
  anesthesia: {
    title: (e) => describeProcedures(e),
    details: (e) => [e.specialty, e.asa && `ASA ${e.asa}`, e.setting === 'ambulant' && 'ambulant',
      e.location, e.procedure],
    tags: (e) => anesthesiaExtras(e),
  },
  measures: {
    title: (r) => r.type,
    details: (r) => [r.location],
    tags: (r) => [r.simulation && 'Simulation', r.ultrasound && 'Ultraschall', r.importId && 'aus Import'],
  },
  icu: {
    title: (r) => [r.organs2 && '≥ 2 Organsysteme', r.ventilation && 'Beatmung/Weaning'].filter(Boolean).join(' + '),
    details: () => [],
    tags: () => [],
  },
  emergencies: {
    title: (r) => [r.vehicle, r.keyword].filter(Boolean).join(' · '),
    details: (r) => [r.supervisor && `unter Anleitung: ${r.supervisor}`],
    tags: () => [],
  },
};

// Liefert alles, was man zum Anzeigen eines Eintrags braucht.
export function describeEntry(kind, entry) {
  const d = DESCRIBERS[kind];
  return {
    title: d.title(entry) || KIND_LABELS[kind],
    details: d.details(entry).filter(Boolean).join(' · '),
    tags: d.tags(entry).filter(Boolean),
  };
}
