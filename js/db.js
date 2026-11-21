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
export const SCHEMA_VERSION = 3;

const STORE_ANESTHESIAS = 'anesthesias';
const STORE_SUPPLEMENTS = 'supplements'; // Nachträge (Sammelzahlen ohne Einzelfall)
const STORE_SETTINGS = 'settings';       // Einstellungen, je Eintrag { key, value }

// Schritt 6: drei weitere Arten von Einträgen, jede in ihrem eigenen Speicherbereich.
// Der Name links ("measures") ist der, den die anderen Dateien benutzen.
export const RECORD_STORES = {
  measures: 'measures',       // Maßnahmen (Einzelleistung ohne eigene Narkose, z. B. ZVK, Bronchoskopie)
  icu: 'icu',                 // Intensiv-Fälle
  emergencies: 'emergencies', // Notarzteinsätze
};
const RECORD_KINDS = Object.keys(RECORD_STORES);

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
    request.onsuccess = () => {
      const db = request.result;
      // Will eine neuere Version der App (z. B. in einem zweiten Tab) die Datenbank umbauen,
      // geben wir sie frei, statt den Umbau zu blockieren. Danach Seite neu laden.
      db.onversionchange = () => db.close();
      resolve(db);
    };
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
  if (oldVersion < 3) {
    // Version 3 (Schritt 6): Maßnahmen, Intensiv, Notarzt. Alles Bisherige bleibt unverändert.
    for (const storeName of Object.values(RECORD_STORES)) {
      const store = db.createObjectStore(storeName, { keyPath: 'id' });
      store.createIndex('by_date', 'date');
    }
  }
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

// ---------- Import (Schritt 5) ----------

// Speichert viele Narkosen auf einmal, in EINER "Transaktion":
// Entweder werden alle gespeichert oder – falls etwas schiefgeht – gar keine.
// Jeder Eintrag bekommt die importId, damit man den Import später rückgängig machen kann.
// measures = Maßnahmen aus derselben Tabelle (z. B. Zeilen, in denen nur ein ZVK steht).
export async function saveImportedAnesthesias(entries, importId, measures = []) {
  const db = await openDatabase();
  const now = new Date().toISOString();
  const tx = db.transaction([STORE_ANESTHESIAS, RECORD_STORES.measures], 'readwrite');
  const store = tx.objectStore(STORE_ANESTHESIAS);
  const measureStore = tx.objectStore(RECORD_STORES.measures);
  measures.forEach((measure) => {
    measureStore.put({
      ...measure, id: createId(), importId, schemaVersion: SCHEMA_VERSION, createdAt: now, updatedAt: now,
    });
  });
  entries.forEach((entry) => {
    store.put({
      ...entry,
      id: createId(),
      importId,
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    });
  });
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return entries.length + measures.length;
}

// Löscht alle Narkosen (und Maßnahmen), die mit dieser importId gespeichert wurden. Gibt die Anzahl zurück.
export async function deleteImportedAnesthesias(importId) {
  const all = await listAnesthesias();
  const matching = all.filter((entry) => entry.importId === importId);
  const matchingMeasures = (await listRecords('measures')).filter((m) => m.importId === importId);
  const db = await openDatabase();
  const tx = db.transaction([STORE_ANESTHESIAS, RECORD_STORES.measures], 'readwrite');
  const store = tx.objectStore(STORE_ANESTHESIAS);
  matching.forEach((entry) => store.delete(entry.id));
  matchingMeasures.forEach((m) => tx.objectStore(RECORD_STORES.measures).delete(m.id));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  return matching.length + matchingMeasures.length;
}

// ---------- Backup (Schritt 5) ----------

// Holt ALLES aus der Datenbank: Narkosen, Nachträge, Einstellungen (als Liste { key, value })
// und die Einträge aus Schritt 6 (measures, icu, emergencies).
export async function readAllData() {
  const db = await openDatabase();
  const storeNames = [STORE_ANESTHESIAS, STORE_SUPPLEMENTS, STORE_SETTINGS, ...Object.values(RECORD_STORES)];
  const tx = db.transaction(storeNames, 'readonly');
  const [anesthesias, supplements, settings, ...records] = await Promise.all(
    storeNames.map((name) => asPromise(tx.objectStore(name).getAll())),
  );
  const data = { anesthesias, supplements, settings };
  RECORD_KINDS.forEach((kind, index) => { data[kind] = records[index]; });
  return data;
}

// Schreibt Daten aus einem Backup zurück – alles in EINER Transaktion über alle drei Bereiche:
// Klappt etwas nicht, bleibt der alte Stand komplett erhalten.
//   replace = true:  vorher alles löschen (Gerät bekommt genau den Stand des Backups)
//   replace = false: nur die übergebenen Einträge hinzufügen (die Auswahl trifft backup.js)
export async function writeBackupData(data, replace) {
  const db = await openDatabase();
  const storeNames = {
    anesthesias: STORE_ANESTHESIAS,
    supplements: STORE_SUPPLEMENTS,
    settings: STORE_SETTINGS,
    ...RECORD_STORES,
  };
  const tx = db.transaction(Object.values(storeNames), 'readwrite');
  for (const [kind, storeName] of Object.entries(storeNames)) {
    const store = tx.objectStore(storeName);
    if (replace) store.clear();
    // Ältere Backups haben z. B. noch keine Maßnahmen: dann ist die Liste einfach leer.
    (data[kind] || []).forEach((record) => store.put(record));
  }
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ---------- Maßnahmen, Intensiv, Notarzt (Schritt 6) ----------
// Alle drei funktionieren gleich, deshalb gibt es nur einen Satz Funktionen.
// kind ist 'measures', 'icu' oder 'emergencies'.

function storeFor(kind) {
  const storeName = RECORD_STORES[kind];
  if (!storeName) throw new Error(`Unbekannte Art von Eintrag: ${kind}`);
  return storeName;
}

export async function saveRecord(kind, entry) {
  const db = await openDatabase();
  const now = new Date().toISOString();
  const record = {
    ...entry,
    id: entry.id || createId(),
    schemaVersion: SCHEMA_VERSION,
    createdAt: entry.createdAt || now,
    updatedAt: now,
  };
  const tx = db.transaction(storeFor(kind), 'readwrite');
  await asPromise(tx.objectStore(storeFor(kind)).put(record));
  return record;
}

export async function getRecord(kind, id) {
  const db = await openDatabase();
  const tx = db.transaction(storeFor(kind), 'readonly');
  return asPromise(tx.objectStore(storeFor(kind)).get(id));
}

// Alle Einträge dieser Art, neueste zuerst.
export async function listRecords(kind) {
  const db = await openDatabase();
  const tx = db.transaction(storeFor(kind), 'readonly');
  const all = await asPromise(tx.objectStore(storeFor(kind)).getAll());
  return all.sort((a, b) =>
    b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

// Alle drei Arten auf einmal: { measures: [...], icu: [...], emergencies: [...] }
export async function listAllRecords() {
  const lists = await Promise.all(RECORD_KINDS.map((kind) => listRecords(kind)));
  return Object.fromEntries(RECORD_KINDS.map((kind, index) => [kind, lists[index]]));
}

export async function deleteRecord(kind, id) {
  const db = await openDatabase();
  const tx = db.transaction(storeFor(kind), 'readwrite');
  await asPromise(tx.objectStore(storeFor(kind)).delete(id));
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

// Fragt nur nach (ohne zu bitten): Ist der Speicherschutz schon aktiv?
// Ergebnis: true, false oder null (Browser kennt die Funktion nicht).
export async function isStoragePersisted() {
  if (navigator.storage && navigator.storage.persisted) {
    try {
      return await navigator.storage.persisted();
    } catch {
      return null;
    }
  }
  return null;
}
