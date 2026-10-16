import { describe, expect, it } from 'vitest';
import { TOKEN_CATALOGUE, evaluate } from '../src/tokens';

// Ported from Immersia Booth tests/unit/tokens.test.ts, plus Immersia 360 cases.
const ctx = {
  eventName: 'Golden Hour',
  flag: '1',
  empty: '',
  __date: new Date(2026, 9, 11, 14, 5, 9).getTime(),
};

describe('token language', () => {
  it('looks up variables case-insensitively and renders unknown tokens empty', () => {
    expect(evaluate('{eventName}', ctx)).toBe('Golden Hour');
    expect(evaluate('{EVENTNAME}', ctx)).toBe('Golden Hour');
    expect(evaluate('[{nope}]', ctx)).toBe('[]');
  });

  it('nests functions', () => {
    expect(evaluate('{if,{flag},Voucher for cocktail,Voucher for soda}', ctx)).toBe('Voucher for cocktail');
    expect(evaluate('{if,{empty},Voucher for cocktail,Voucher for soda}', ctx)).toBe('Voucher for soda');
    expect(evaluate('{upper,{left,6,{eventName}}}', ctx)).toBe('GOLDEN');
  });

  it('evaluates a three-level nested expression', () => {
    expect(evaluate('{default,{empty},{lower,{right,4,{eventName}}}}', ctx)).toBe('hour');
  });

  it('treats escaped commas and braces as literal text', () => {
    expect(evaluate('{default,{empty},Hello\\, world}', ctx)).toBe('Hello, world');
    expect(evaluate('\\{eventName\\}', ctx)).toBe('{eventName}');
    expect(evaluate('{default,{empty},a \\{b\\} c}', ctx)).toBe('a {b} c');
  });

  it('formats session dates strftime-style', () => {
    expect(evaluate('%Y-%m-%d %H:%M:%S', ctx)).toBe('2026-10-11 14:05:09');
    expect(evaluate('%A %d %B', ctx)).toBe('Sunday 11 October');
    expect(evaluate('100%%', ctx)).toBe('100%');
  });

  it('accepts the session date as a Date, number or ISO string', () => {
    const d = new Date(2026, 0, 2, 3, 4, 5);
    expect(evaluate('%d/%m', { __date: d })).toBe('02/01');
    expect(evaluate('%d/%m', { __date: d.getTime() })).toBe('02/01');
    expect(evaluate('%d/%m', { __date: d.toISOString() })).toBe('02/01');
  });

  it('supports the legacy @token@ syntax', () => {
    expect(evaluate('@eventName@', ctx)).toBe('Golden Hour');
  });

  it('string and logic functions', () => {
    expect(evaluate('{mid,2,3,abcdef}', ctx)).toBe('bcd');
    expect(evaluate('{field,2,one two three}', ctx)).toBe('two');
    expect(evaluate('{field2,2,;,a;b;c}', ctx)).toBe('b');
    expect(evaluate('{capitalize,hello there}', ctx)).toBe('Hello There');
    expect(evaluate('{compare,a,a}{lessThan,2,10}{contains,Golden,old}', ctx)).toBe('111');
    expect(evaluate('{urlencode,a b&c}', ctx)).toBe('a%20b%26c');
  });

  it('leaves an unterminated brace as literal text instead of throwing', () => {
    expect(evaluate('Hello {eventName', ctx)).toBe('Hello {eventName');
  });

  it('caps recursion depth on pathological input', () => {
    const deep = '{upper,'.repeat(40) + 'x' + '}'.repeat(40);
    expect(() => evaluate(deep, ctx)).not.toThrow();
  });

  it('every catalogue token evaluates without throwing', () => {
    for (const fam of TOKEN_CATALOGUE) for (const t of fam.tokens) expect(typeof evaluate(t.token, ctx)).toBe('string');
  });
});
