// csv.js – liest eine CSV-Datei (z. B. aus Excel gespeichert) in Zeilen und Spalten.
//
// CSV heißt "comma-separated values": eine Textdatei, in der jede Zeile eine Tabellenzeile ist
// und die Zellen durch ein Trennzeichen getrennt sind. Deutsches Excel nimmt dafür meist ";".
// Diese Datei rechnet nur, sie zeigt nichts an und speichert nichts.

// Macht aus den Bytes der Datei einen Text.
// Normal ist UTF-8 (Excel: "CSV UTF-8"). Hat jemand die ältere Variante "CSV (Trennzeichen-getrennt)"
// gewählt, ist die Datei in "Windows-1252" gespeichert; dann wären Umlaute kaputt (�).
// In dem Fall lesen wir die Datei einfach noch einmal mit der alten Kodierung.
export function decodeBytes(buffer) {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  const text = utf8.includes('�') ? new TextDecoder('windows-1252').decode(buffer) : utf8;
  // Das unsichtbare Zeichen am Anfang ("BOM") entfernen, das Excel bei UTF-8 davorsetzt.
  return text.replace(/^﻿/, '');
}

// Findet das Trennzeichen: das Zeichen, das in der ersten Zeile am häufigsten vorkommt.
export function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const candidates = [';', ',', '\t'];
  let best = ';';
  let bestCount = -1;
  candidates.forEach((candidate) => {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  });
  return best;
}

// Zerlegt den Text in eine Liste von Zeilen, jede Zeile ist eine Liste von Zellen (Text).
// Beachtet Anführungszeichen: "a;b" ist EINE Zelle, "" darin ist ein echtes Anführungszeichen.
export function parseCsv(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  // letzte Zeile (falls die Datei nicht mit einem Zeilenumbruch endet)
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // ganz leere Zeilen weglassen (Excel hängt oft ";;;;;" an)
  return rows.filter((r) => r.some((value) => value.trim() !== ''));
}

// ---------- Schreiben (Schritt 5: Export) ----------

// Macht aus einer Zelle sicheren CSV-Text.
function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  // Schutz: Beginnt eine Zelle mit = + - oder @, würde Excel sie als Formel ausführen.
  // Ein vorangestelltes ' sorgt dafür, dass Excel sie als normalen Text zeigt.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  // Enthält die Zelle ; " oder einen Zeilenumbruch, muss sie in Anführungszeichen stehen.
  if (/[;"\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

// Baut aus Zeilen (Listen von Zellen) eine CSV-Datei für deutsches Excel:
// Trennzeichen ";", Zeilenende wie bei Windows, und das BOM-Zeichen am Anfang,
// an dem Excel erkennt, dass die Datei UTF-8 ist (sonst wären Umlaute kaputt).
export function toCsv(rows) {
  return `﻿${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
