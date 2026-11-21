// options.js – die Auswahlmöglichkeiten im Formular.
// Wer eine Option ergänzen oder umbenennen will, ändert nur diese Datei.
// Achtung: Umbenennen ändert alte Einträge nicht – die behalten den alten Text.

export const SPECIALTIES = [
  'Abdominell', 'Thorax', 'Kopf-Hals', 'Intrakraniell', 'Geburtshilfe', 'Sectio', 'Sonstige',
];

export const ASA_CLASSES = ['1', '2', '3', '4', '5', '6'];

export const GENERAL_ANESTHESIA = ['keine', 'ITN', 'ITN (RSI)', 'LAMA', 'Maske', 'DLT'];

export const NEURAXIAL = ['keine', 'Spinal', 'PDK lumbal', 'PDK thorakal', 'CSE', 'Kaudal'];

// Periphere Blöcke. Weitere kann man im Formular selbst ergänzen;
// sie tauchen dann beim nächsten Mal automatisch als Auswahl auf.
// Kaudalblock steht bei "Rückenmarksnah", weil er dort mitzählt.
export const BLOCKS = [
  'Adduktorenkanal', 'FIB', 'TAP', 'ESB', 'DIB', 'NFK', 'NIK',
  'Interskalenär', 'Supraklavikulär', 'Axillär', 'PWB',
];

export const AIRWAY_TECHNIQUES = ['Videolaryngoskopie', 'Fiberoptik'];

export const LOCATIONS = ['Zentral-OP', 'Kreißsaal', 'MRT', 'Endoskopie'];

export const MAX_BLOCKS = 2;
