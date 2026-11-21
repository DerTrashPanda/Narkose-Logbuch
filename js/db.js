// db.js – alles rund ums Speichern auf dem Gerät.
//
// IndexedDB ist eine kleine Datenbank, die jeder Browser eingebaut hat.
// Die Daten bleiben auf diesem Gerät, auch ohne Internet, und gehen an keinen Server.
// Andere Dateien der App sprechen nur über die Funktionen hier mit der Datenbank.

const DB_NAME = 'narkose-logbuch';

// Schema-Version: die "Bauplan-Nummer" der Datenbank.
// Wenn sich später der Aufbau ändert (z. B. neuer Speicherbereich für Maßnahmen),
// erhöhen wir diese Zahl und ergänzen unten in upgradeDatabase() einen neuen Schritt.
// Alte Einträge bleiben dabei erhalten.
export const SCHEMA_VERSION = 2;

const STORE_ANESTHESIAS = 'anesthesias';
const STORE_SUPPLEMENTS = 'supplements'; // Nachträge (Sammelzahlen ohne Einzelfall)
const STORE_SETTINGS = 'settings';       // Einstellungen, je Eintrag { key, value }

let dbPromise = null;

// Öffnet die Datenbank (nur einmal pro Seitenaufruf).
function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, SCHEMA_VERSION);

    // Läuft nur, wenn die Datenbank neu ist oder die Schema-Version gestiegen ist.
    request.onupgradeneeded = (event) => {
      upgradeDatabase(request.result, event.oldVersion);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

// Baut die Datenbank Schritt für Schritt von der alten auf die neue Version um.
function upgradeDatabase(db, oldVersion) {
  if (oldVersion < 1) {
    // Version 1: Speicherbereich für Narkosen. Jeder Eintrag hat eine eindeutige "id".
    const store = db.createObjectStore(STORE_ANESTHESIAS, { keyPath: 'id' });
    // Ein "Index" ist wie ein Register im Buch: schnelles Sortieren/Suchen nach Datum.
    store.createIndex('by_date', 'date');
  }
  if (oldVersion < 2) {
    // Version 2 (Schritt 3): Nachträge und Einstellungen. Die Narkosen bleiben unverändert.
    db.createObjectStore(STORE_SUPPLEMENTS, { keyPath: 'id' });
    db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
  }
  // Später z. B.:
  // if (oldVersion < 3) { db.createObjectStore('measures', { keyPath: 'id' }); }
}

// Hilfsfunktion: macht aus einer IndexedDB-Anfrage ein Promise (einfacher zu benutzen).
function asPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Erzeugt eine zufällige, eindeutige ID für einen neuen Eintrag.
function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Speichert eine Narkose. Ohne id = neuer Eintrag, mit id = Änderung eines bestehenden.
export async function saveAnesthesia(entry) {
  const db = await openDatabase();
  const now = new Date().toISOString();
  const record = {
    ...entry,
    id: entry.id || createId(),
    schemaVersion: SCHEMA_VERSION,
    createdAt: entry.createdAt || now,
    updatedAt: now,
  };
  const tx = db.transaction(STORE_ANESTHESIAS, 'readwrite');
  await asPromise(tx.objectStore(STORE_ANESTHESIAS).put(record));
  return record;
}

// Holt einen einzelnen Eintrag.
export async function getAnesthesia(id) {
  const db = await openDatabase();
  const tx = db.transaction(STORE_ANESTHESIAS, 'readonly');
  return asPromise(tx.objectStore(STORE_ANESTHESIAS).get(id));
}

// Holt alle Narkosen, neueste zuerst.
export async function listAnesthesias() {
  const db = await openDatabase();
  const tx = db.transaction(STORE_ANESTHESIAS, 'readonly');
  const all = await asPromise(tx.objectStore(STORE_ANESTHESIAS).getAll());
  // Nach Datum absteigend; am selben Tag der zuletzt angelegte oben.
  return all.sort((a, b) =>
    b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

// Löscht einen Eintrag endgültig.
export async function deleteAnesthesia(id) {
  const db = await openDatabase();
  const tx = db.transaction(STORE_ANESTHESIAS, 'readwrite');
  await asPromise(tx.objectStore(STORE_ANESTHESIAS).delete(id));
}

// ---------- Nachträge ----------

// Speichert einen Nachtrag: { category, amount, from, to, source, note }
export async function saveSupplement(supplement) {
  const db = await openDatabase();
  const now = new Date().toISOString();
  const record = {
    ...supplement,
    id: supplement.id || createId(),
    schemaVersion: SCHEMA_VERSION,
    createdAt: supplement.createdAt || now,
    updatedAt: now,
  };
  const tx = db.transaction(STORE_SUPPLEMENTS, 'readwrite');
  await asPromise(tx.objectStore(STORE_SUPPLEMENTS).put(record));
  return record;
}

// Alle Nachträge, neueste zuerst.
export async function listSupplements() {
  const db = await openDatabase();
  const tx = db.transaction(STORE_SUPPLEMENTS, 'readonly');
  const all = await asPromise(tx.objectStore(STORE_SUPPLEMENTS).getAll());
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteSupplement(id) {
  const db = await openDatabase();
  const tx = db.transaction(STORE_SUPPLEMENTS, 'readwrite');
  await asPromise(tx.objectStore(STORE_SUPPLEMENTS).delete(id));
}

// ---------- Einstellungen ----------

// Standardwerte, solange man nichts geändert hat.
export const DEFAULT_SETTINGS = {
  // Allgemeinanästhesie + Regionalverfahren beim selben Patienten = 2 Verfahren (vom Nutzer entschieden)
  countSeparately: true,
};

// Holt alle Einstellungen als ein Objekt, z. B. { countSeparately: true }.
export async function getSettings() {
  const db = await openDatabase();
  const tx = db.transaction(STORE_SETTINGS, 'readonly');
  const rows = await asPromise(tx.objectStore(STORE_SETTINGS).getAll());
  const settings = { ...DEFAULT_SETTINGS };
  rows.forEach((row) => { settings[row.key] = row.value; });
  return settings;
}

export async function saveSetting(key, value) {
  const db = await openDatabase();
  const tx = db.transaction(STORE_SETTINGS, 'readwrite');
  await asPromise(tx.objectStore(STORE_SETTINGS).put({ key, value }));
}

// Bittet den Browser, unsere Daten nicht automatisch zu löschen, wenn der Speicher knapp wird.
// Der Browser entscheidet selbst; Chrome sagt meist "ja", wenn die Seite oft benutzt wird.
export async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}
