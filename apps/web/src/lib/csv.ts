/**
 * CSV for guest-contact exports (SHR-6). Two things matter beyond RFC 4180:
 * - Excel opens a CSV in the system code page unless the file starts with a UTF-8 byte-order mark,
 *   which turns "José" into "JosÃ©"; so exports start with one.
 * - Guests type the cells. A name like `=HYPERLINK("http://evil","Click")` becomes a live formula
 *   when the operator opens the file (CSV injection), so a text cell that starts with `=`, `+`, `-`
 *   or `@`, or with a tab or carriage return, is prefixed with an apostrophe, which spreadsheets
 *   read as "this is text" and display without. Leading spaces do not hide a formula from Excel, so
 *   they are looked through.
 */
export const CSV_BOM = '﻿';

export type CsvValue = string | number | Date | null | undefined;

const FORMULA_START = /^(?:[\t\r]|\s*[=+\-@])/;

/** One cell, always quoted: text stays text, commas, quotes and line breaks are safe. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'number') text = Number.isFinite(value) ? String(value) : '';
  else text = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

/** One record, without its line ending. */
export const csvRow = (cells: readonly CsvValue[]): string => cells.map(csvCell).join(',');

/** A whole file: BOM, header, records, CRLF line endings (what Excel expects). */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return CSV_BOM + [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}
