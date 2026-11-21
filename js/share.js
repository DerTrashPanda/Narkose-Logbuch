// share.js – gibt eine fertige Datei an den Nutzer weiter: Teilen (Handy) oder Herunterladen (PC).
//
// Zwei Wege:
// 1) "Web Share": Auf dem Handy öffnet sich das Teilen-Menü des Systems.
//    iPhone: dort "In Dateien sichern", AirDrop, Mail …  Android: Drive, Mail, WhatsApp an dich selbst …
// 2) Herunterladen: Die Datei landet im Download-Ordner. Das klappt am PC und auf Android immer.
//
// Diese Datei sendet nichts ins Internet. Erst DU entscheidest im Teilen-Menü, wohin die Datei geht.

// Ist das ein Touch-Gerät (Handy/Tablet)? Am PC ist Herunterladen praktischer als Teilen.
function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches;
}

// Kann dieses Gerät genau diese Datei teilen? (Android-Chrome teilt z. B. keine .json-Dateien,
// dann nehmen wir automatisch das Herunterladen.)
export function canShareFile(file) {
  return Boolean(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
}

// Lädt die Datei herunter: Wir bauen einen unsichtbaren Link auf die Datei und "klicken" ihn.
export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  // Die Adresse erst etwas später freigeben, sonst bricht der Download manchmal ab.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Öffnet das Teilen-Menü. Ergebnis: 'shared', 'cancelled' oder 'blocked'.
// 'blocked' heißt: Der Browser erlaubt das Teilen nur direkt nach einem Fingertipp,
// und das Vorbereiten der Datei hat zu lange gedauert. Dann zeigen wir einen zweiten Knopf.
export async function shareFile(file) {
  try {
    await navigator.share({ files: [file], title: file.name });
    return 'shared';
  } catch (error) {
    if (error.name === 'AbortError') return 'cancelled'; // Menü einfach geschlossen
    if (error.name === 'NotAllowedError') return 'blocked';
    throw error;
  }
}

// Der Normalfall: auf dem Handy teilen, sonst herunterladen.
// Ergebnis: 'shared', 'downloaded', 'cancelled' oder 'blocked'.
export async function deliverFile(file) {
  if (isTouchDevice() && canShareFile(file)) return shareFile(file);
  downloadFile(file);
  return 'downloaded';
}

// ---------- Knopf "Datei ist fertig" (Ersatzweg, falls das Teilen blockiert wurde) ----------

const readyBox = document.getElementById('file-ready');
const readyName = document.getElementById('file-ready-name');
const readyShare = document.getElementById('file-ready-share');
const readyDownload = document.getElementById('file-ready-download');
let pending = null; // { file, onDelivered }

function hideReadyBox() {
  readyBox.hidden = true;
  pending = null;
}

readyShare.addEventListener('click', async () => {
  if (!pending) return;
  const { file, onDelivered } = pending;
  const result = await shareFile(file);
  if (result === 'shared') {
    hideReadyBox();
    onDelivered(result);
  }
});

readyDownload.addEventListener('click', () => {
  if (!pending) return;
  const { file, onDelivered } = pending;
  downloadFile(file);
  hideReadyBox();
  onDelivered('downloaded');
});

document.getElementById('file-ready-close').addEventListener('click', hideReadyBox);

// Gibt die Datei weiter. onDelivered(result) wird aufgerufen, sobald sie geteilt
// oder heruntergeladen wurde (nicht bei Abbruch) – auch, wenn das erst über den Ersatzknopf passiert.
export async function handOverFile(file, onDelivered = () => {}) {
  hideReadyBox();
  const result = await deliverFile(file);
  if (result === 'shared' || result === 'downloaded') {
    onDelivered(result);
  } else if (result === 'blocked') {
    pending = { file, onDelivered };
    readyName.textContent = file.name;
    readyShare.hidden = !canShareFile(file);
    readyBox.hidden = false;
    readyBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return result;
}
