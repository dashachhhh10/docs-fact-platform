/**
 * Parses a CSV File object via PapaParse.
 * Returns a Promise<object[]> — one object per row, keys = header columns.
 * All string values are trimmed; empty strings become null.
 */
export function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header:         true,
      skipEmptyLines: true,
      trimHeaders:    true,
      transform:      val => {
        const s = String(val).trim();
        return s === '' ? null : s;
      },
      complete: result => {
        if (result.errors.length > 0) {
          const fatal = result.errors.filter(e => e.type === 'Delimiter' || e.type === 'Quotes');
          if (fatal.length > 0) {
            reject(new Error(`Ошибка парсинга: ${fatal[0].message}`));
            return;
          }
        }
        resolve(result.data);
      },
      error: err => reject(new Error(`Ошибка чтения файла: ${err.message}`)),
    });
  });
}

/**
 * Validates that a parsed array has the required columns.
 * Throws if any column is missing.
 */
export function validateColumns(rows, required, fileName) {
  if (!rows || rows.length === 0) {
    throw new Error(`${fileName}: файл пустой или не содержит данных`);
  }
  const cols = Object.keys(rows[0]);
  const missing = required.filter(c => !cols.includes(c));
  if (missing.length > 0) {
    throw new Error(`${fileName}: отсутствуют колонки: ${missing.join(', ')}`);
  }
}

export const REQUIRED_COLUMNS = {
  trips: [
    'trip_id', 'route_from', 'route_to',
    'planned_departure', 'planned_arrival',
  ],
  documents: [
    'doc_id', 'trip_id', 'doc_status',
  ],
  gps_events: [
    'event_id', 'trip_id', 'event_type', 'timestamp',
  ],
  proofs: [
    'proof_id', 'trip_id', 'stage', 'timestamp',
  ],
};
