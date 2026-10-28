import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvCell, csvRow, toCsv } from './csv';

describe('csvCell', () => {
  it('quotes every cell and doubles embedded quotes', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('defuses formulas: = + - @ and a leading tab or carriage return get an apostrophe', () => {
    expect(csvCell('=1+1')).toBe(`"'=1+1"`);
    expect(csvCell('+44 20 7946 0958')).toBe(`"'+44 20 7946 0958"`);
    expect(csvCell('-2+3')).toBe(`"'-2+3"`);
    expect(csvCell('@SUM(A1:A9)')).toBe(`"'@SUM(A1:A9)"`);
    expect(csvCell('\t=1+1')).toBe(`"'\t=1+1"`);
    expect(csvCell('\r=1+1')).toBe(`"'\r=1+1"`);
    expect(csvCell('=HYPERLINK("http://evil.example","Click")')).toBe(
      `"'=HYPERLINK(""http://evil.example"",""Click"")"`,
    );
  });

  it('looks through leading spaces, which do not hide a formula from Excel', () => {
    expect(csvCell('  =cmd|calc')).toBe(`"'  =cmd|calc"`);
    expect(csvCell(' @x')).toBe(`"' @x"`);
  });

  it('leaves ordinary text alone, including a symbol that is not at the start', () => {
    expect(csvCell('ada@example.com')).toBe('"ada@example.com"');
    expect(csvCell('Anne-Marie')).toBe('"Anne-Marie"');
    expect(csvCell('1+1')).toBe('"1+1"');
    expect(csvCell('José Núñez 山田')).toBe('"José Núñez 山田"');
  });

  it('writes empty values, numbers and dates', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('')).toBe('""');
    // Numbers are numbers, not guest text: a negative one is not a formula.
    expect(csvCell(-3)).toBe('"-3"');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(new Date('2026-10-20T09:30:00Z'))).toBe('"2026-10-20T09:30:00.000Z"');
  });
});

describe('toCsv', () => {
  it('starts with a UTF-8 byte-order mark and uses CRLF line endings', () => {
    const csv = toCsv(['Name', 'Email'], [['Ada', 'ada@example.com']]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe(`${CSV_BOM}"Name","Email"\r\n"Ada","ada@example.com"\r\n`);
    // Encoded as UTF-8 the BOM is the three bytes Excel looks for.
    expect([...new TextEncoder().encode(csv).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('is just the header when there are no rows', () => {
    expect(toCsv(['A'], [])).toBe(`${CSV_BOM}"A"\r\n`);
  });

  it('renders a row of mixed values', () => {
    expect(csvRow(['x', 2, null, new Date(0)])).toBe(`"x","2",,"1970-01-01T00:00:00.000Z"`);
  });
});
