/**
 * Token language, ported from Immersia Booth (src/core/tokens.ts). A small recursive-descent
 * evaluator shared by every feature that renders text: strip title panels (PHO-3), overlay text,
 * email/SMS bodies (SHR-3), signage (DL-5) and filenames.
 *
 *   {name}                 variable lookup (case-insensitive)
 *   {fn,arg1,arg2}         function call; args are themselves token strings, so tokens nest
 *   %Y %m %d ...           strftime-style date of the session start (ctx.__date)
 *   @name@                 legacy syntax
 *   \{ \} \, \\            literal characters
 *
 * Unknown tokens render empty.
 */

export type TokenContext = Record<string, string | number | boolean | Date | undefined | null>;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function strftime(code: string, d: Date): string | null {
  const h12 = d.getHours() % 12 || 12;
  const start = new Date(d.getFullYear(), 0, 0);
  const doy = Math.floor((d.getTime() - start.getTime()) / 86400000);
  const day = DAYS[d.getDay()]!;
  const month = MONTHS[d.getMonth()]!;
  switch (code) {
    case 'a':
      return day.slice(0, 3);
    case 'A':
      return day;
    case 'b':
      return month.slice(0, 3);
    case 'B':
      return month;
    case 'd':
      return pad(d.getDate());
    case 'D':
      return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${pad(d.getFullYear() % 100)}`;
    case 'H':
      return pad(d.getHours());
    case 'I':
      return pad(h12);
    case 'j':
      return pad(doy, 3);
    case 'm':
      return pad(d.getMonth() + 1);
    case 'M':
      return pad(d.getMinutes());
    case 'p':
      return d.getHours() < 12 ? 'AM' : 'PM';
    case 'S':
      return pad(d.getSeconds());
    case 'x':
      return d.toLocaleDateString();
    case 'X':
      return d.toLocaleTimeString();
    case 'y':
      return pad(d.getFullYear() % 100);
    case 'Y':
      return String(d.getFullYear());
    case '%':
      return '%';
    default:
      return null;
  }
}

const truthy = (s: string) => s !== '' && s !== '0' && s.toLowerCase() !== 'false';

type Fn = (args: string[], ctx: TokenContext) => string;

const FUNCTIONS: Record<string, Fn> = {
  left: ([n = '', s = '']) => s.slice(0, parseInt(n) || 0),
  right: ([n = '', s = '']) => {
    const k = parseInt(n) || 0;
    return k ? s.slice(-k) : '';
  },
  mid: ([n = '', m = '', s = '']) => {
    const from = Math.max(0, (parseInt(n) || 1) - 1);
    return s.slice(from, from + (parseInt(m) || 0));
  },
  field: ([n = '', s = '']) => s.split(/\s+/)[(parseInt(n) || 1) - 1] ?? '',
  field2: ([n = '', ch = ',', s = '']) => s.split(ch)[(parseInt(n) || 1) - 1] ?? '',
  first: ([s = '']) => s.split(/\s+/)[0] ?? '',
  last: ([s = '']) => {
    const p = s.trim().split(/\s+/);
    return p[p.length - 1] ?? '';
  },
  upper: ([s = '']) => s.toUpperCase(),
  lower: ([s = '']) => s.toLowerCase(),
  capitalize: ([s = '']) => s.replace(/\b\w/g, (c) => c.toUpperCase()),
  default: ([a = '', b = '']) => (a !== '' ? a : b),
  if: ([t = '', a = '', b = '']) => (truthy(t) ? a : b),
  compare: ([a = '', b = '']) => (a === b ? '1' : '0'),
  lessThan: ([a = '', b = '']) => (parseFloat(a) < parseFloat(b) ? '1' : '0'),
  contains: ([a = '', b = '']) => (a.toLowerCase().includes(b.toLowerCase()) ? '1' : '0'),
  random: ([n = '1', m = '1']) => {
    const lo = parseInt(n) || 0;
    const hi = parseInt(m) || lo;
    return String(lo + Math.floor(Math.random() * (hi - lo + 1)));
  },
  urlencode: ([s = '']) => encodeURIComponent(s),
};

export const TOKEN_FUNCTIONS = Object.keys(FUNCTIONS);

/** Split the inside of {...} on top-level commas, respecting nested braces and escapes. */
function splitArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (c === '\\' && i + 1 < inner.length) {
      cur += c + inner[++i];
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function stringify(v: TokenContext[string]): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function lookup(name: string, ctx: TokenContext): string {
  const key = name.trim();
  if (key in ctx) return stringify(ctx[key]);
  const lower = key.toLowerCase();
  for (const k of Object.keys(ctx)) if (k.toLowerCase() === lower) return stringify(ctx[k]);
  return '';
}

function sessionDate(ctx: TokenContext): Date {
  const raw = ctx.__date;
  if (raw instanceof Date) return raw;
  if (typeof raw === 'number') return new Date(raw);
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return new Date(t);
  }
  return new Date();
}

export function evaluate(template: string, ctx: TokenContext, depth = 0): string {
  if (!template || depth > 12) return template ?? '';
  const date = sessionDate(ctx);
  let out = '';
  let i = 0;
  while (i < template.length) {
    const c = template[i]!;
    const next = template[i + 1];
    // \{ \} \, \\ are literal, so commas and braces can appear inside function arguments.
    if (c === '\\' && next !== undefined && '{},\\'.includes(next)) {
      out += next;
      i += 2;
      continue;
    }
    if (c === '{') {
      let d = 1;
      let j = i + 1;
      for (; j < template.length && d > 0; j++) {
        if (template[j] === '\\') {
          j++;
          continue;
        }
        if (template[j] === '{') d++;
        else if (template[j] === '}') d--;
      }
      if (d !== 0) {
        out += template.slice(i);
        break;
      }
      const parts = splitArgs(template.slice(i + 1, j - 1));
      const head = parts[0]!.trim();
      const fn = FUNCTIONS[head];
      if (fn && parts.length > 1) {
        out += fn(
          parts.slice(1).map((a) => evaluate(a, ctx, depth + 1)),
          ctx,
        );
      } else if (fn && head === 'random') {
        out += fn([], ctx);
      } else {
        out += lookup(evaluate(head, ctx, depth + 1), ctx);
      }
      i = j;
      continue;
    }
    if (c === '%' && next !== undefined) {
      const r = strftime(next, date);
      if (r !== null) {
        out += r;
        i += 2;
        continue;
      }
    }
    if (c === '@') {
      const end = template.indexOf('@', i + 1);
      if (end > i + 1 && /^[A-Za-z0-9_]+$/.test(template.slice(i + 1, end))) {
        out += lookup(template.slice(i + 1, end), ctx);
        i = end + 1;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

/** Context keys every surface provides. Keep in sync with TOKEN_CATALOGUE. */
export interface StandardTokenContext extends TokenContext {
  eventName: string;
  eventDate: string;
  hashtag?: string;
  custom1?: string;
  custom2?: string;
  custom3?: string;
  shortCode?: string;
  sessionUrl?: string;
  shotNumber?: number;
  shotCount?: number;
  __date?: Date | number | string;
}

/** Catalogue for the token picker (keys are i18n message ids under `tokens.*`). */
export const TOKEN_CATALOGUE = [
  {
    family: 'event',
    tokens: [
      { token: '{eventName}', hint: 'eventName' },
      { token: '{eventDate}', hint: 'eventDate' },
      { token: '{hashtag}', hint: 'hashtag' },
      { token: '{custom1}', hint: 'custom1' },
      { token: '{custom2}', hint: 'custom2' },
      { token: '{custom3}', hint: 'custom3' },
    ],
  },
  {
    family: 'session',
    tokens: [
      { token: '{shortCode}', hint: 'shortCode' },
      { token: '{sessionUrl}', hint: 'sessionUrl' },
      { token: '{shotNumber}', hint: 'shotNumber' },
      { token: '{shotCount}', hint: 'shotCount' },
    ],
  },
  {
    family: 'date',
    tokens: [
      { token: '%d %B %Y', hint: 'dateLong' },
      { token: '%d.%m.%Y', hint: 'dateShort' },
      { token: '%H:%M', hint: 'time24' },
    ],
  },
  {
    family: 'functions',
    tokens: [
      { token: '{upper,{eventName}}', hint: 'upper' },
      { token: '{default,{custom1},fallback}', hint: 'default' },
      { token: '{if,{custom1},a,b}', hint: 'if' },
      { token: '{left,3,{eventName}}', hint: 'left' },
      { token: '{urlencode,{eventName}}', hint: 'urlencode' },
    ],
  },
] as const satisfies readonly { family: string; tokens: readonly { token: string; hint: string }[] }[];

/**
 * The token context for an event's templates (PHO-3 dynamic fields). One builder for the editor
 * preview, the photo strip and the 360 overlay, so the same text renders the same everywhere.
 * `date` is the event's ISO date; formatted dates (`%d %B %Y`) read it at local noon so no time zone
 * can move it to the day before.
 */
export function eventTokens(
  event: { name: string; date: string },
  branding: { hashtag?: string; custom1?: string; custom2?: string; custom3?: string },
  session?: { shortCode: string; url: string } | null,
  shot?: { number: number; count: number },
): StandardTokenContext {
  return {
    eventName: event.name,
    eventDate: event.date,
    hashtag: branding.hashtag ?? '',
    custom1: branding.custom1 ?? '',
    custom2: branding.custom2 ?? '',
    custom3: branding.custom3 ?? '',
    shortCode: session?.shortCode ?? '',
    sessionUrl: session?.url ?? '',
    shotNumber: shot?.number,
    shotCount: shot?.count,
    __date: new Date(`${event.date}T12:00:00`),
  };
}
