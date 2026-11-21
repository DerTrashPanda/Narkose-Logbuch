// backup.js – Vollbackup: ALLE Daten in eine Datei sichern und daraus wiederherstellen.
//
// Das Backup ist eine JSON-Datei. JSON ist ein einfaches Textformat für Daten
// (man kann es mit jedem Texteditor öffnen). Darin stehen alle Narkosen, Maßnahmen, Intensiv-Fälle,
// Notarzteinsätze, Nachträge und Einstellungen.
// Wofür? Wenn das Handy kaputtgeht, verloren geht oder du die App auf ein neues Gerät umziehst.
// Die Datei verlässt das Gerät nur dorthin, wohin DU sie teilst oder speicherst.

import {
  readAllData, writeBackupData, getSettings, saveSetting, SCHEMA_VERSION,
  requestPersistentStorage, isStoragePersisted,
} from './db.js';
import { handOverFile } from './share.js';

// Erkennungszeichen in der Datei, damit wir nicht versehentlich irgendeine andere JSON-Datei einlesen.
const BACKUP_APP = 'Narkose-Logbuch';
// Version des Datei-Aufbaus (nicht der Datenbank). Erhöhen, falls sich der Aufbau der Datei ändert.
const BACKUP_FORMAT = 1;
// Ab so vielen Tagen ohne Backup erscheint eine Erinnerung.
const REMINDER_DAYS = 14;
// Diese Einstellung gehört zum Gerät, nicht ins Backup (sonst würde ein altes Backup sie zurückdrehen).
const DEVICE_ONLY_SETTINGS = ['lastBackup'];

// Die Einträge aus Schritt 6. Backups von vor Schritt 6 haben diese Listen noch nicht –
// dann gelten sie als leer.
const RECORD_KINDS = ['measures', 'icu', 'emergencies'];
// Alle Arten von Einträgen, mit Namen für die Anzeige (Einzahl, Mehrzahl)
const ALL_KINDS = [
  ['anesthesias', 'Narkose', 'Narkosen'],
  ['measures', 'Maßnahme', 'Maßnahmen'],
  ['icu', 'Intensiv-Fall', 'Intensiv-Fälle'],
  ['emergencies', 'Notarzteinsatz', 'Notarzteinsätze'],
  ['supplements', 'Nachtrag', 'Nachträge'],
];

const backupButton = document.getElementById('backup-create');
const backupStatus = document.getElementById('backup-status');
const restoreInput = document.getElementById('restore-file');
const restoreError = document.getElementById('restore-error');
const restoreStep = document.getElementById('restore-step');
const restoreSummary = document.getElementById('restore-summary');
const restoreMergeText = document.getElementById('restore-merge-text');
const restoreReplaceText = document.getElementById('restore-replace-text');
const restoreConfirm = document.getElementById('restore-confirm');
const restoreCancel = document.getElementById('restore-cancel');
const storageStatus = document.getElementById('storage-status');

// ---------- kleine Helfer ----------

function formatDateTime(isoString) {
  const date = new Date(isoString);
  const time = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `${date.toLocaleDateString('de-DE')} ${time}`;
}

function todayString() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function showMessage(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => { toast.hidden = true; }, 3500);
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

// "264 Narkosen, 4 Maßnahmen, 3 Nachträge" – Arten mit 0 Einträgen werden weggelassen
// (außer Narkosen, die stehen immer da). counts = { anesthesias: 264, measures: 4, ... }
function describeCounts(counts) {
  return ALL_KINDS
    .filter(([kind]) => kind === 'anesthesias' || counts[kind])
    .map(([kind, one, many]) => plural(counts[kind] || 0, one, many))
    .join(', ');
}

function countsOf(data) {
  return Object.fromEntries(ALL_KINDS.map(([kind]) => [kind, (data[kind] || []).length]));
}

// ---------- Backup erstellen ----------

async function createBackupFile() {
  const data = await readAllData();
  const backup = {
    app: BACKUP_APP,
    backupFormat: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    counts: countsOf(data),
    anesthesias: data.anesthesias,
    supplements: data.supplements,
    measures: data.measures,
    icu: data.icu,
    emergencies: data.emergencies,
    settings: data.settings.filter((row) => !DEVICE_ONLY_SETTINGS.includes(row.key)),
  };
  // JSON.stringify macht aus den Daten Text; die 1 sorgt für Zeilenumbrüche (besser lesbar).
  const text = JSON.stringify(backup, null, 1);
  const name = `narkose-logbuch-backup-${todayString()}.json`;
  // Ein "File" ist eine Datei im Arbeitsspeicher – noch nirgends gespeichert.
  return { file: new File([text], name, { type: 'application/json' }), backup };
}

backupButton.addEventListener('click', async () => {
  backupButton.disabled = true;
  try {
    const { file, backup } = await createBackupFile();
    await handOverFile(file, async () => {
      await saveSetting('lastBackup', backup.createdAt);
      renderBackupStatus();
      showMessage(`Backup mit ${describeCounts(backup.counts)} erstellt.`);
    });
  } catch (error) {
    showMessage(`Backup hat nicht geklappt: ${error.message}`);
  } finally {
    backupButton.disabled = false;
  }
  // Gute Gelegenheit, den Browser um dauerhaften Speicher zu bitten.
  requestPersistentStorage().then(renderStorageStatus);
});

// Zeigt an, wann das letzte Backup war – mit Erinnerung nach 14 Tagen.
async function renderBackupStatus() {
  const [{ lastBackup }, data] = await Promise.all([getSettings(), readAllData()]);
  const hasData = ALL_KINDS.some(([kind]) => data[kind].length > 0);
  if (!lastBackup) {
    backupStatus.textContent = hasData
      ? 'Noch kein Backup erstellt. Bitte einmal sichern.'
      : 'Noch kein Backup erstellt.';
    backupStatus.classList.toggle('warning', hasData);
    return;
  }
  const days = Math.floor((Date.now() - new Date(lastBackup).getTime()) / 86400000);
  const ago = days === 0 ? 'heute' : `vor ${plural(days, 'Tag', 'Tagen')}`;
  const tooOld = days >= REMINDER_DAYS;
  backupStatus.textContent = `Letztes Backup: ${formatDateTime(lastBackup)} (${ago}).`
    + (tooOld ? ' Zeit für ein neues Backup.' : '');
  backupStatus.classList.toggle('warning', tooOld && hasData);
}

// ---------- Backup wiederherstellen ----------

let pendingRestore = null; // das geprüfte Backup, bis du auf "Wiederherstellen" tippst

// Prüft, ob die Datei wirklich ein Backup dieser App ist. Gibt eine Fehlermeldung oder null zurück.
function checkBackup(backup) {
  if (!backup || backup.app !== BACKUP_APP) {
    return 'Das ist keine Backup-Datei des Narkose-Logbuchs.';
  }
  if (backup.backupFormat > BACKUP_FORMAT || backup.schemaVersion > SCHEMA_VERSION) {
    return 'Dieses Backup stammt aus einer neueren Version der App. Bitte erst die App aktualisieren (Profil → Version).';
  }
  if (!Array.isArray(backup.anesthesias) || !Array.isArray(backup.supplements)
    || !Array.isArray(backup.settings)) {
    return 'Die Backup-Datei ist unvollständig.';
  }
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const broken = backup.anesthesias.find((e) => !e || !e.id || !datePattern.test(e.date || ''));
  if (broken) return 'In der Backup-Datei ist eine Narkose ohne gültige ID oder Datum. Datei beschädigt?';
  if (backup.supplements.some((s) => !s || !s.id || !s.category)) {
    return 'In der Backup-Datei ist ein Nachtrag ohne gültige ID oder Kategorie. Datei beschädigt?';
  }
  for (const kind of RECORD_KINDS) {
    if (backup[kind] === undefined) continue; // älteres Backup ohne diese Liste: in Ordnung
    if (!Array.isArray(backup[kind])
      || backup[kind].some((r) => !r || !r.id || !datePattern.test(r.date || ''))) {
      return 'In der Backup-Datei ist ein Eintrag ohne gültige ID oder Datum. Datei beschädigt?';
    }
  }
  return null;
}

// Vergleicht Backup und Gerät: was ist neu, was gibt es schon, was ist unterschiedlich?
function compare(backupRecords, deviceRecords) {
  const onDevice = new Map(deviceRecords.map((r) => [r.id, r]));
  const inBackup = new Set(backupRecords.map((r) => r.id));
  const result = { added: [], same: 0, different: 0, onlyOnDevice: 0 };
  backupRecords.forEach((record) => {
    const existing = onDevice.get(record.id);
    if (!existing) result.added.push(record);
    else if (existing.updatedAt === record.updatedAt) result.same += 1;
    else result.different += 1; // gleicher Eintrag, aber geändert: Gerät behält seine Fassung
  });
  deviceRecords.forEach((record) => { if (!inBackup.has(record.id)) result.onlyOnDevice += 1; });
  return result;
}

restoreInput.addEventListener('change', async () => {
  const file = restoreInput.files[0];
  restoreInput.value = ''; // damit man dieselbe Datei nochmal wählen kann
  if (!file) return;
  closeRestore();

  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    showRestoreError('Die Datei lässt sich nicht lesen. Ist das wirklich die .json-Backup-Datei?');
    return;
  }
  const problem = checkBackup(backup);
  if (problem) {
    showRestoreError(problem);
    return;
  }

  // Ältere Backups (vor Schritt 6) haben noch keine Maßnahmen usw.: als leere Liste behandeln
  RECORD_KINDS.forEach((kind) => { backup[kind] = backup[kind] || []; });

  const device = await readAllData();
  // Für jede Art vergleichen: { anesthesias: {added, same, ...}, measures: {...}, ... }
  const comparison = Object.fromEntries(ALL_KINDS.map(([kind]) => [kind, compare(backup[kind], device[kind])]));
  pendingRestore = { backup, device, comparison };

  restoreSummary.textContent = `Backup vom ${formatDateTime(backup.createdAt)}: `
    + `${describeCounts(countsOf(backup))}. `
    + `Auf diesem Gerät jetzt: ${describeCounts(countsOf(device))}.`;

  const all = Object.values(comparison);
  const added = Object.fromEntries(ALL_KINDS.map(([kind]) => [kind, comparison[kind].added.length]));
  const kept = all.reduce((sum, c) => sum + c.same + c.different, 0);
  const different = all.reduce((sum, c) => sum + c.different, 0);
  restoreMergeText.textContent = `Neu dazu: ${describeCounts(added)}. `
    + `${kept} schon vorhanden, bleiben unverändert`
    + (different
      ? ` (davon ${different} auf dem Gerät inzwischen geändert – deine Gerätefassung bleibt).`
      : '.')
    + ' Einstellungen des Geräts bleiben.';

  const removed = all.reduce((sum, c) => sum + c.onlyOnDevice, 0);
  restoreReplaceText.textContent = 'Das Gerät bekommt genau den Stand des Backups, inklusive Einstellungen. '
    + (removed
      ? `Achtung: ${plural(removed, 'Eintrag, der', 'Einträge, die')} nur auf dem Gerät ${removed === 1 ? 'ist, wird' : 'sind, werden'} gelöscht.`
      : 'Es geht dabei nichts verloren, was nur auf dem Gerät ist.');

  restoreStep.querySelector('input[value="merge"]').checked = true;
  restoreStep.hidden = false;
  restoreStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function showRestoreError(message) {
  restoreError.textContent = message;
  restoreError.hidden = false;
}

function closeRestore() {
  pendingRestore = null;
  restoreStep.hidden = true;
  restoreError.hidden = true;
}

restoreCancel.addEventListener('click', closeRestore);

restoreConfirm.addEventListener('click', async () => {
  if (!pendingRestore) return;
  const { backup, device, comparison } = pendingRestore;
  const replace = restoreStep.querySelector('input[name="restore-mode"]:checked').value === 'replace';

  if (replace) {
    const question = `Wirklich alles ersetzen? Danach sind auf dem Gerät genau die Einträge aus dem Backup: `
      + `${describeCounts(countsOf(backup))}.`;
    if (!confirm(question)) return;
  }

  // Geräte-eigene Einstellungen (letztes Backup) beim Ersetzen behalten.
  const deviceOnly = device.settings.filter((row) => DEVICE_ONLY_SETTINGS.includes(row.key));
  const data = {};
  ALL_KINDS.forEach(([kind]) => { data[kind] = replace ? backup[kind] : comparison[kind].added; });
  data.settings = replace
    ? [...backup.settings.filter((row) => !DEVICE_ONLY_SETTINGS.includes(row.key)), ...deviceOnly]
    : [];
  const addedCounts = Object.fromEntries(ALL_KINDS.map(([kind]) => [kind, comparison[kind].added.length]));

  restoreConfirm.disabled = true;
  try {
    await writeBackupData(data, replace);
  } catch (error) {
    showRestoreError(`Wiederherstellen hat nicht geklappt, es wurde nichts verändert: ${error.message}`);
    restoreConfirm.disabled = false;
    return;
  }
  restoreConfirm.disabled = false;
  closeRestore();
  // Liste, Übersicht und Import-Hinweis neu laden (app.js und import.js hören darauf)
  window.dispatchEvent(new Event('entries-changed'));
  renderBackupStatus();
  showMessage(replace
    ? `Backup wiederhergestellt: ${describeCounts(countsOf(backup))}.`
    : `Aus dem Backup hinzugefügt: ${describeCounts(addedCounts)}.`);
});

// ---------- Speicherschutz (Anzeige im Profil) ----------

async function renderStorageStatus() {
  const persisted = await isStoragePersisted();
  if (persisted === true) {
    storageStatus.textContent = 'aktiv – der Browser löscht deine Daten nicht von selbst.';
  } else if (persisted === false) {
    storageStatus.textContent = 'noch nicht bestätigt. Der Browser könnte bei sehr vollem Speicher '
      + 'Daten löschen. Wird oft automatisch aktiv, wenn die App installiert ist und regelmäßig benutzt wird. '
      + 'Regelmäßige Backups schützen in jedem Fall.';
  } else {
    storageStatus.textContent = 'wird von diesem Browser nicht unterstützt. Regelmäßige Backups schützen deine Daten.';
  }
}

// ---------- Start ----------

window.addEventListener('entries-changed', () => { renderBackupStatus().catch(() => {}); });
renderBackupStatus().catch(() => {});
// In der installierten App beim Start um dauerhaften Speicher bitten (Chrome entscheidet still).
// Im normalen Browser-Tab nicht, weil z. B. Firefox dafür jedes Mal ein Pop-up zeigen würde.
// (Nach jedem Speichern einer Narkose fragt app.js ohnehin nach.)
const isInstalled = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
(isInstalled ? requestPersistentStorage() : Promise.resolve())
  .then(renderStorageStatus).catch(() => {});
