// pwa.js – macht aus der Webseite eine installierbare Offline-App (PWA = Progressive Web App).
// Aufgaben:
//  1. Den Service Worker (sw.js) anmelden.
//  2. Einen Hinweis zeigen, wenn eine neue Version bereitliegt, und sie auf Knopfdruck laden.
//  3. Unter "Profil" anzeigen, ob die App offline bereit ist, und (auf Android) einen
//     "App installieren"-Knopf anbieten.

const updateBanner = document.getElementById('update-banner');
const updateButton = document.getElementById('update-button');
const offlineStatus = document.getElementById('offline-status');
const appVersion = document.getElementById('app-version');
const installButton = document.getElementById('install-button');
const installHint = document.getElementById('install-hint');

// Wird true, wenn du im Update-Hinweis auf "Neu laden" getippt hast.
// Nur dann laden wir die Seite neu (nicht beim allerersten Einrichten).
let updateRequested = false;
let reloading = false;

function setOfflineStatus(text) {
  if (offlineStatus) offlineStatus.textContent = text;
}

// Fragt den aktiven Service Worker nach seiner Versionsnummer und zeigt sie an.
function showVersion() {
  const controller = navigator.serviceWorker.controller;
  if (!controller || !appVersion) return;
  controller.postMessage('GET_VERSION');
}

// Zeigt den Update-Hinweis für einen wartenden (neuen) Service Worker.
function offerUpdate(worker) {
  updateBanner.hidden = false;
  updateButton.onclick = () => {
    updateButton.disabled = true;
    updateRequested = true;
    worker.postMessage('SKIP_WAITING');
  };
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setOfflineStatus('Dieser Browser unterstützt keinen Offline-Modus.');
    return;
  }

  // Antworten des Service Workers (hier: die Versionsnummer) empfangen.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'VERSION' && appVersion) {
      appVersion.textContent = event.data.version;
    }
  });

  // Sobald die neue Version die Kontrolle übernimmt: Seite einmal neu laden.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested) {
      // Erstes Einrichten: kein Neuladen nötig, nur Status und Version anzeigen.
      setOfflineStatus('Bereit: Die App funktioniert jetzt auch ohne Internet.');
      showVersion();
      return;
    }
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  try {
    // "./sw.js" relativ zur Seite: klappt auf GitHub Pages im Unterordner /Narkose-Logbuch/.
    const registration = await navigator.serviceWorker.register('./sw.js');

    // Fall A: Eine neue Version wartet schon (z. B. vom letzten Öffnen).
    if (registration.waiting && navigator.serviceWorker.controller) {
      offerUpdate(registration.waiting);
    }

    // Fall B: Während die App offen ist, wird eine neue Version gefunden.
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state !== 'installed') return;
        if (navigator.serviceWorker.controller) {
          offerUpdate(newWorker); // es gab schon eine Version → Update anbieten
        } else {
          setOfflineStatus('Bereit: Die App funktioniert jetzt auch ohne Internet.');
        }
      });
    });

    // Beim Zurückkehren in die App (z. B. nach Stunden im Hintergrund) nach Updates schauen.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });

    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) {
      setOfflineStatus('Bereit: Die App funktioniert auch ohne Internet.');
      showVersion();
    }
  } catch (error) {
    // Passiert z. B., wenn die Seite als Datei (file://) statt über einen Server geöffnet wird.
    setOfflineStatus('Offline-Modus konnte nicht eingerichtet werden.');
    console.warn('Service Worker nicht registriert:', error);
  }
}

// ---------- "App installieren"-Knopf (nur Android/Chrome und PC-Chrome/Edge) ----------
// Chrome meldet mit "beforeinstallprompt", dass die App installiert werden kann.
// Wir heben das Ereignis auf und zeigen stattdessen unseren eigenen Knopf.
let installPrompt = null;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  if (installButton) installButton.hidden = false;
});

if (installButton) {
  installButton.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installButton.hidden = true;
  });
}

window.addEventListener('appinstalled', () => {
  if (installButton) installButton.hidden = true;
  if (installHint) installHint.textContent = 'Die App ist installiert.';
});

// Läuft die App schon als installierte App (ohne Browserleiste)?
const isStandalone = window.matchMedia('(display-mode: standalone)').matches
  || window.navigator.standalone === true; // iPhone
if (isStandalone && installHint) {
  installHint.textContent = 'Die App ist installiert.';
}

registerServiceWorker();
