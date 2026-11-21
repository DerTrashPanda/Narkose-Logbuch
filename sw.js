// sw.js – der Service Worker.
// Ein Service Worker ist ein kleines Hintergrund-Programm, das der Browser für unsere Seite
// aufbewahrt. Er sitzt zwischen App und Internet: Jede Anfrage (z. B. "gib mir style.css")
// läuft durch ihn. Er legt beim ersten Besuch alle Dateien der App in einen Cache
// (einen Zwischenspeicher auf dem Gerät) und liefert sie von dort aus – auch ohne Internet.
//
// WICHTIG beim Weiterentwickeln:
// Bei JEDER Änderung an einer App-Datei die Versionsnummer unten erhöhen.
// Nur dann merkt der Browser, dass es eine neue Version gibt, und lädt alles neu.

const VERSION = '5.0.0';
const CACHE_NAME = `narkose-logbuch-${VERSION}`;

// Alle Dateien, die die App zum Laufen braucht. Pfade relativ zu sw.js,
// damit es im Unterordner /Narkose-Logbuch/ auf GitHub Pages funktioniert.
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/db.js',
  './js/options.js',
  './js/counting.js',
  './js/overview.js',
  './js/pwa.js',
  './js/csv.js',
  './js/import-mapping.js',
  './js/import.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// 1) Installieren: alle Dateien frisch aus dem Netz holen und in den neuen Cache legen.
//    { cache: 'reload' } umgeht den normalen Browser-Zwischenspeicher, damit wirklich
//    die neue Version im Cache landet.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' }))),
    ),
  );
  // Kein skipWaiting() hier: Die neue Version wartet, bis du im Update-Hinweis
  // auf "Neu laden" tippst. So wird dir nie mitten im Eintippen die App ausgetauscht.
});

// 2) Aktivieren: alte Caches früherer Versionen löschen, damit kein Speicher verschwendet wird.
//    Deine Fälle liegen NICHT im Cache, sondern in IndexedDB – die bleiben unberührt.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('narkose-logbuch-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

// 3) Anfragen beantworten: "Cache zuerst".
//    Liegt die Datei im Cache, kommt sie sofort von dort (schnell und offline).
//    Sonst wird sie aus dem Netz geholt.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Nur einfache Lese-Anfragen an unsere eigene Adresse behandeln.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).catch(() => {
        // Offline und nicht im Cache: Bei einem Seitenaufruf die Startseite zeigen.
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      });
    }),
  );
});

// 4) Nachricht von der App: "Neue Version jetzt übernehmen" (Knopf im Update-Hinweis).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: VERSION });
  }
});
