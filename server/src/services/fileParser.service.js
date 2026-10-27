import fs from 'node:fs';
import path from 'node:path';
import csvParser from 'csv-parser';
import { readSheet } from 'read-excel-file/node';
import { normalizeHeader, findMissingRequiredColumns } from '../utils/headerMapper.util.js';

/**
 * Thrown for problems with the file itself (unsupported type, empty file,
 * missing required columns) as opposed to individual bad rows.
 */
export class FileParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FileParseError';
  }
}

export function detectFileType(fileName = '') {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.csv') return 'csv';
  if (ext === '.xlsx') return 'xlsx';
  return null;
}

const isEmptyRow = (data) =>
  Object.values(data).every((v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === ''));

/**
 * Unified CSV + Excel reader. Inspects the file extension and returns the same
 * standardized shape for both formats:
 *
 *   [{ rowNumber: 2, data: { orderId, orderDate, ... } }, ...]
 *
 * - Headers are normalised to canonical keys (see headerMapper.util.js).
 * - `rowNumber` is the spreadsheet row (header = row 1, first data row = 2),
 *   which is what users see in Excel and what the error report refers to.
 * - Completely empty rows are skipped.
 *
 * @param {string} filePath      path of the uploaded temp file
 * @param {string} originalName  original file name (decides CSV vs Excel)
 */
export async function parseFile(filePath, originalName) {
  const type = detectFileType(originalName || filePath);

  if (type === 'csv') return parseCsv(filePath);
  if (type === 'xlsx') return parseExcel(filePath);

  throw new FileParseError('Unsupported file type. Please upload a .csv or .xlsx file.');
}

/* ------------------------------- CSV ------------------------------------- */

function parseCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let headers = [];
    let dataIndex = 0;
    const seen = new Set();

    const parser = csvParser({
      skipComments: false,
      // Normalise each header; when two columns map to the same canonical key
      // (e.g. "Total" and "Amount") the first one wins and the rest are dropped.
      mapHeaders: ({ header }) => {
        const key = normalizeHeader(header);
        if (!key || seen.has(key)) return null;
        seen.add(key);
        return key;
      },
    });

    const source = fs.createReadStream(filePath);
    source.on('error', reject);
    parser.on('error', (err) => reject(new FileParseError(`Could not read CSV: ${err.message}`)));

    parser.on('headers', (h) => {
      headers = h;
    });

    parser.on('data', (data) => {
      dataIndex += 1;
      if (isEmptyRow(data)) return;
      rows.push({ rowNumber: dataIndex + 1, data });
    });

    parser.on('end', () => {
      if (headers.length === 0) return reject(new FileParseError('The CSV file is empty.'));

      const missing = findMissingRequiredColumns(headers);
      if (missing.length) {
        return reject(new FileParseError(`Missing required column(s): ${missing.join(', ')}`));
      }
      if (rows.length === 0) return reject(new FileParseError('The CSV file has no data rows.'));
      resolve(rows);
    });

    source.pipe(parser);
  });
}

/* ------------------------------ Excel ------------------------------------ */

async function parseExcel(filePath) {
  const fileBuffer = await fs.promises.readFile(filePath);

  let sheet;
  try {
    // read-excel-file returns a 2D array (rows of cells) for the first sheet.
    sheet = await readSheet(fileBuffer);
  } catch (err) {
    throw new FileParseError(`Could not read Excel file: ${err.message}`);
  }

  if (!sheet || sheet.length === 0) throw new FileParseError('The Excel file is empty.');

  // First row = headers; the remaining rows are mapped into objects.
  const headers = sheet[0].map((header) => normalizeHeader(header));

  const missing = findMissingRequiredColumns(headers);
  if (missing.length) {
    throw new FileParseError(`Missing required column(s): ${missing.join(', ')}`);
  }

  const rows = [];
  for (let i = 1; i < sheet.length; i += 1) {
    const cells = sheet[i];

    const data = headers.reduce((acc, header, index) => {
      // First column wins when several headers map to the same canonical key.
      if (header && acc[header] === undefined) acc[header] = cells[index] ?? null;
      return acc;
    }, {});

    if (isEmptyRow(data)) continue;
    rows.push({ rowNumber: i + 1, data });
  }

  if (rows.length === 0) throw new FileParseError('The Excel file has no data rows.');
  return rows;
}
