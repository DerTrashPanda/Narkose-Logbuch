# Narkose-Logbuch
Ich möchte eine App bauen, um die Fallzahlen für das eLogbuch Anästhesie zu dokumentieren.

Online: https://dertrashpanda.github.io/Narkose-Logbuch/

## Neue Version veröffentlichen
Die App speichert ihre Dateien für den Offline-Betrieb auf dem Handy (Service Worker, Datei `sw.js`).
Damit eine Änderung bei dir ankommt:
1. In `sw.js` die Zahl bei `const VERSION = '…'` erhöhen (z. B. 4.0.0 → 4.0.1).
2. Kommt eine neue Datei dazu, sie in `APP_FILES` in `sw.js` eintragen.
3. Nach dem Mergen erscheint in der App oben „Neue Version verfügbar – Neu laden“.
