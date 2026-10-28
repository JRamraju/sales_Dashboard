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
 * Opens a CSV or Excel upload and returns the same standardized shape for both:
 *
 *   {
 *     type:      'csv' | 'xlsx',
 *     totalRows: number | null,   // known up front for Excel, unknown for a streamed CSV
 *     rows:      AsyncIterable<{ rowNumber: 2, data: { orderId, orderDate, ... } }>,
 *     progress:  () => number,    // 0..1 of the file consumed so far
 *     close:     () => void,      // release the file handle early
 *   }
 *
 * - Headers are normalised to canonical keys (see headerMapper.util.js).
 * - `rowNumber` is the spreadsheet row (header = row 1, first data row = 2),
 *   which is what users see in Excel and what the error report refers to.
 * - Completely empty rows are skipped.
 * - Problems with the file as a whole (empty, unreadable, missing required
 *   columns) reject right here, before any row is processed.
 *
 * A CSV is *streamed*: rows are handed out as they are parsed, so memory stays
 * flat however large the file is (the previous version parsed every row into
 * one array first). The Excel reader has to load the whole sheet, which is a
 * limit of the library and of the .xlsx format.
 *
 * @param {string} filePath      path of the uploaded temp file
 * @param {string} originalName  original file name (decides CSV vs Excel)
 */
export async function openRowSource(filePath, originalName) {
  const type = detectFileType(originalName || filePath);

  if (type === 'csv') return openCsv(filePath);
  if (type === 'xlsx') return openExcel(filePath);

  throw new FileParseError('Unsupported file type. Please upload a .csv or .xlsx file.');
}

/**
 * Convenience wrapper that reads the whole file into an array. Fine for tests
 * and small files; the upload worker uses openRowSource() so it never holds a
 * large CSV in memory.
 */
export async function parseFile(filePath, originalName) {
  const source = await openRowSource(filePath, originalName);
  const rows = [];
  try {
    for await (const row of source.rows) rows.push(row);
  } finally {
    source.close();
  }
  if (rows.length === 0) {
    throw new FileParseError(`The ${source.type === 'csv' ? 'CSV' : 'Excel'} file has no data rows.`);
  }
  return rows;
}

/* ------------------------------- CSV ------------------------------------- */

const SEPARATORS = [',', ';', '\t', '|'];

/**
 * Excel in many locales (most of Europe, parts of Asia) saves "CSV" with
 * semicolons. The header line is counted for each candidate separator
 * (ignoring text inside quotes) and the most frequent one wins; comma wins ties.
 */
async function sniffSeparator(filePath) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(16 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const firstLine = buffer
      .toString('utf8', 0, bytesRead)
      .replace(/^﻿/, '')
      .split(/\r?\n/, 1)[0];

    const counts = new Map(SEPARATORS.map((sep) => [sep, 0]));
    let inQuotes = false;
    for (const char of firstLine) {
      if (char === '"') inQuotes = !inQuotes;
      else if (!inQuotes && counts.has(char)) counts.set(char, counts.get(char) + 1);
    }

    let best = ',';
    for (const [sep, count] of counts) {
      if (count > counts.get(best)) best = sep;
    }
    return best;
  } finally {
    await handle.close();
  }
}

async function openCsv(filePath) {
  const { size } = await fs.promises.stat(filePath);
  if (size === 0) throw new FileParseError('The CSV file is empty.');

  const separator = await sniffSeparator(filePath);
  const seen = new Set();

  const parser = csvParser({
    separator,
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
  source.on('error', (err) => parser.destroy(err));
  source.pipe(parser);

  const close = () => {
    source.destroy();
    parser.destroy();
  };

  // Wait for the header line so file-level problems fail before any row work.
  let headers;
  try {
    headers = await new Promise((resolve, reject) => {
      parser.once('headers', resolve);
      parser.once('error', reject);
      parser.once('finish', () => resolve([])); // input ended without a header line
    });
  } catch (err) {
    close();
    throw new FileParseError(`Could not read CSV: ${err.message}`);
  }

  if (headers.length === 0) {
    close();
    throw new FileParseError('The CSV file is empty.');
  }
  const missing = findMissingRequiredColumns(headers);
  if (missing.length) {
    close();
    throw new FileParseError(`Missing required column(s): ${missing.join(', ')}`);
  }

  async function* rows() {
    // csv-parser emits one object per line (a blank line gives an empty
    // object), so counting objects keeps row numbers aligned with the file.
    let dataIndex = 0;
    try {
      for await (const data of parser) {
        dataIndex += 1;
        if (isEmptyRow(data)) continue;
        yield { rowNumber: dataIndex + 1, data };
      }
    } catch (err) {
      if (err instanceof FileParseError) throw err;
      throw new FileParseError(`Could not read CSV: ${err.message}`);
    } finally {
      close();
    }
  }

  return {
    type: 'csv',
    totalRows: null,
    rows: rows(),
    progress: () => (size > 0 ? Math.min(1, source.bytesRead / size) : 0),
    close,
  };
}

/* ------------------------------ Excel ------------------------------------ */

async function openExcel(filePath) {
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

  const dataRowCount = sheet.length - 1;
  let position = 0;

  // An async generator, like the CSV one, so callers get the same interface
  // (`rows[Symbol.asyncIterator]()`) whichever file type they opened.
  async function* rows() {
    for (let i = 1; i < sheet.length; i += 1) {
      position = i;
      const cells = sheet[i];

      const data = {};
      headers.forEach((header, index) => {
        // First column wins when several headers map to the same canonical key.
        if (header && data[header] === undefined) data[header] = cells[index] ?? null;
      });

      if (isEmptyRow(data)) continue;
      yield { rowNumber: i + 1, data };
    }
  }

  return {
    type: 'xlsx',
    totalRows: dataRowCount,
    rows: rows(),
    progress: () => (dataRowCount > 0 ? Math.min(1, position / dataRowCount) : 1),
    close: () => {},
  };
}
