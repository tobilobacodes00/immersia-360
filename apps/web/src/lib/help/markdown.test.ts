import { describe, expect, it } from 'vitest';
import {
  headings,
  inlineText,
  links,
  parseInline,
  parseMarkdown,
  plainText,
  safeHref,
  slugify,
  type Block,
  type Inline,
} from './markdown';

const para = (src: string): Inline[] => {
  const [b] = parseMarkdown(src);
  if (b?.t !== 'p') throw new Error(`expected a paragraph, got ${b?.t}`);
  return b.c;
};

describe('help Markdown: inline', () => {
  it('reads emphasis, strong text and code', () => {
    expect(parseInline('a **b** *c* _d_ `e`')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'strong', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'd' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'e' },
    ]);
  });

  it('leaves snake_case and stray markers alone', () => {
    expect(inlineText(parseInline('use snake_case_names and 2 * 3 = 6'))).toBe('use snake_case_names and 2 * 3 = 6');
  });

  it('does not format inside code and honours escapes', () => {
    expect(parseInline('`**not bold**`')).toEqual([{ t: 'code', v: '**not bold**' }]);
    expect(inlineText(parseInline('\\*literal\\* and \\[brackets\\]'))).toBe('*literal* and [brackets]');
  });

  it('keeps nested emphasis inside strong text', () => {
    const [strong] = parseInline('**bold and *italic***');
    expect(strong).toMatchObject({ t: 'strong' });
    expect(inlineText(parseInline('**bold and *italic***'))).toBe('bold and italic');
  });

  it('treats HTML as text, so it can never become markup', () => {
    const nodes = para('<script>alert(1)</script> and <b>bold</b> <img src=x onerror=alert(1)>');
    expect(nodes.every((n) => n.t === 'text')).toBe(true);
    expect(inlineText(nodes)).toContain('<script>alert(1)</script>');
  });
});

describe('help Markdown: links', () => {
  it.each([
    ['help:setup-check', { kind: 'help', slug: 'setup-check', anchor: null }],
    ['help:cloud-copy-errors#reauth_required', { kind: 'help', slug: 'cloud-copy-errors', anchor: 'reauth_required' }],
    ['/studio/devices', { kind: 'internal', href: '/studio/devices' }],
    ['#section', { kind: 'anchor', href: '#section' }],
    ['https://example.com/a?b=1', { kind: 'external', href: 'https://example.com/a?b=1' }],
    ['mailto:help@example.com', { kind: 'mailto', href: 'mailto:help@example.com' }],
  ])('allows %s', (href, expected) => {
    expect(safeHref(href)).toEqual(expected);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '//evil.example/x',
    '/\\evil.example',
    'relative/path',
    'ftp://example.com',
    'https:///nohost',
    'help:Bad Slug',
    'mailto:not an address',
    '',
  ])('refuses %j', (href) => {
    expect(safeHref(href)).toBeNull();
  });

  it('drops the link but keeps the words when the address is unsafe', () => {
    const nodes = para('see [the page](javascript:alert(1)) now');
    expect(nodes.some((n) => n.t === 'link')).toBe(false);
    expect(inlineText(nodes)).toBe('see the page now');
  });

  it('collects every address in a document', () => {
    const doc = parseMarkdown('Read [a](help:one) and **[b](/studio/devices)**.\n\n- [c](https://example.com)\n');
    expect(links(doc)).toEqual(['help:one', '/studio/devices', 'https://example.com']);
  });
});

describe('help Markdown: blocks', () => {
  it('reads headings with stable, unique ids', () => {
    const doc = parseMarkdown('## Set up\n\ntext\n\n### Set up\n\n## Cámara y lente');
    expect(headings(doc)).toEqual([
      { level: 2, id: 'set-up', text: 'Set up' },
      { level: 3, id: 'set-up-2', text: 'Set up' },
      { level: 2, id: 'camara-y-lente', text: 'Cámara y lente' },
    ]);
    expect(slugify('Chrome: --kiosk-printing (Windows)')).toBe('chrome-kiosk-printing-windows');
  });

  it('lets a heading fix its own id, so deep links survive translation', () => {
    const doc = parseMarkdown('### Access was revoked {#reauth_required}\n\n### Access was revoked');
    expect(headings(doc)).toEqual([
      { level: 3, id: 'reauth_required', text: 'Access was revoked' },
      { level: 3, id: 'access-was-revoked', text: 'Access was revoked' },
    ]);
  });

  it('demotes a body "#" to a section heading, since the article title is the page\'s h1', () => {
    expect(parseMarkdown('# Title')[0]).toMatchObject({ t: 'heading', level: 2 });
  });

  it('joins the lines of a paragraph and splits paragraphs at blank lines', () => {
    const doc = parseMarkdown('one\ntwo\n\nthree');
    expect(doc.map((b) => b.t)).toEqual(['p', 'p']);
    expect(inlineText((doc[0] as Extract<Block, { t: 'p' }>).c)).toBe('one two');
  });

  it('reads bullet and numbered lists, with nesting and continuation lines', () => {
    const doc = parseMarkdown(
      ['- first', '  continued', '  - nested a', '  - nested b', '- second', '', '1. one', '2. two'].join('\n'),
    );
    expect(doc.map((b) => b.t)).toEqual(['list', 'list']);
    const [bullets, numbers] = doc as Extract<Block, { t: 'list' }>[];
    expect(bullets!.ordered).toBe(false);
    expect(bullets!.items).toHaveLength(2);
    const first = bullets!.items[0]!;
    expect(first.map((b) => b.t)).toEqual(['p', 'list']);
    expect(inlineText((first[0] as Extract<Block, { t: 'p' }>).c)).toBe('first continued');
    expect((first[1] as Extract<Block, { t: 'list' }>).items).toHaveLength(2);
    expect(numbers!.ordered).toBe(true);
    expect(numbers!.items).toHaveLength(2);
  });

  it('keeps a list together across blank lines and holds code blocks inside items', () => {
    const doc = parseMarkdown('1. one\n\n2. two\n\n   ```\n   code\n   ```\n3. three');
    expect(doc).toHaveLength(1);
    const list = doc[0] as Extract<Block, { t: 'list' }>;
    expect(list.items).toHaveLength(3);
    expect(list.items[1]!.map((b) => b.t)).toEqual(['p', 'code']);
  });

  it('reads fenced code verbatim, including Markdown-looking lines', () => {
    const doc = parseMarkdown('```bash\nchrome --kiosk-printing\n# not a heading\n- not a list\n```\nafter');
    expect(doc[0]).toEqual({
      t: 'code',
      lang: 'bash',
      v: 'chrome --kiosk-printing\n# not a heading\n- not a list',
    });
    expect(doc[1]?.t).toBe('p');
  });

  it('reads callouts and plain quotes', () => {
    const doc = parseMarkdown('> [!WARNING]\n> A browser cannot lock a device.\n\n> Just a quote');
    expect(doc[0]).toMatchObject({ t: 'quote', kind: 'warning' });
    expect(plainText([doc[0]!])).toBe('A browser cannot lock a device.');
    expect(doc[1]).toMatchObject({ t: 'quote', kind: null });
  });

  it('reads pipe tables, padding ragged rows', () => {
    const doc = parseMarkdown('| Key | Action |\n| --- | --- |\n| `Space` | Start |\n| End |\n\nafter');
    const table = doc[0] as Extract<Block, { t: 'table' }>;
    expect(table.t).toBe('table');
    expect(table.head.map(inlineText)).toEqual(['Key', 'Action']);
    expect(table.rows.map((r) => r.map(inlineText))).toEqual([
      ['Space', 'Start'],
      ['End', ''],
    ]);
    expect(doc[1]?.t).toBe('p');
  });

  it('reads horizontal rules', () => {
    expect(parseMarkdown('a\n\n---\n\nb').map((b) => b.t)).toEqual(['p', 'hr', 'p']);
  });

  it('makes plain text of a whole document for search', () => {
    const text = plainText(parseMarkdown('## Title\n\nSome **bold** words.\n\n- item one\n- item two'));
    expect(text).toContain('Title');
    expect(text).toContain('Some bold words.');
    expect(text).toContain('item one item two');
  });
});
