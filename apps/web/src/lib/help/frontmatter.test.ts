import { describe, expect, it } from 'vitest';
import { FrontmatterError, parseArticleSource, parseFrontmatterBlock, splitFrontmatter } from './frontmatter';

const valid = `---
title: Run the setup check
summary: Check the camera, storage and render speed before an event.
category: start
order: 20
keywords: [test, "camera, lens", 'fps']
updated: 2026-10-19
related: [getting-started, camera-permissions]
---

## First heading

Body text.
`;

describe('help front matter', () => {
  it('reads scalars, quoted strings and inline lists', () => {
    const { data, body } = parseArticleSource(valid);
    expect(data).toMatchObject({
      title: 'Run the setup check',
      category: 'start',
      order: 20,
      keywords: ['test', 'camera, lens', 'fps'],
      related: ['getting-started', 'camera-permissions'],
      updated: '2026-10-19',
    });
    expect(body.startsWith('## First heading')).toBe(true);
  });

  it('reads a list wrapped over several lines, as Prettier formats a long one', () => {
    const wrapped = valid.replace(
      'keywords: [test, "camera, lens", \'fps\']',
      'keywords:\n  [\n    test,\n    "camera, lens",\n    \'fps\',\n  ]',
    );
    expect(parseArticleSource(wrapped).data.keywords).toEqual(['test', 'camera, lens', 'fps']);
    expect(parseArticleSource(wrapped).data.related).toEqual(['getting-started', 'camera-permissions']);
  });

  it('keeps a bare number in the keywords as a search word', () => {
    const { data } = parseArticleSource(
      valid.replace('keywords: [test, "camera, lens", \'fps\']', 'keywords: [360, 4k]'),
    );
    expect(data.keywords).toEqual(['360', '4k']);
  });

  it('reads a list written as a block, and an empty list', () => {
    expect(parseFrontmatterBlock('keywords:\n  - one\n  - "two, three"\nrelated: []')).toEqual({
      keywords: ['one', 'two, three'],
      related: [],
    });
  });

  it("keeps an apostrophe inside a plain item (marca d'água) and still reads a quoted one", () => {
    expect(parseFrontmatterBlock("keywords: [marca d'água, 'it''s', \"say \\\"hi\\\"\", plain]")).toEqual({
      keywords: ["marca d'água", "it's", 'say "hi"', 'plain'],
    });
  });

  it('reads a trailing comma but not a missing bracket in a wrapped list', () => {
    expect(parseFrontmatterBlock('keywords: [a, b,]')).toEqual({ keywords: ['a', 'b'] });
    expect(() => parseFrontmatterBlock('keywords:\n  [\n    a,\n    b,')).toThrow(/unterminated list/);
  });

  it('accepts Windows line endings and a byte order mark', () => {
    const { data } = parseArticleSource(`\uFEFF${valid.replace(/\n/g, '\r\n')}`);
    expect(data.title).toBe('Run the setup check');
  });

  it('keeps a colon inside a value', () => {
    const { data } = parseArticleSource(valid.replace('Run the setup check', 'Setup: the check'));
    expect(data.title).toBe('Setup: the check');
  });

  it('takes a video only together with its captions (WCAG 2.2 captions on help videos)', () => {
    const withVideo = valid.replace('---\n\n', 'video: /help/videos/setup.mp4\n---\n\n');
    expect(() => parseArticleSource(withVideo)).toThrow(/needs captions/);
    const both = withVideo.replace('---\n\n', 'captions: /help/videos/setup.en.vtt\n---\n\n');
    expect(parseArticleSource(both).data).toMatchObject({
      video: '/help/videos/setup.mp4',
      captions: '/help/videos/setup.en.vtt',
    });
    expect(() => parseArticleSource(valid.replace('---\n\n', 'captions: /help/videos/a.vtt\n---\n\n'))).toThrow(
      /without a video/,
    );
  });

  it('only allows media files under /help/videos with the right extension', () => {
    const bad = (extra: string) => parseArticleSource(valid.replace('---\n\n', `${extra}\n---\n\n`));
    expect(() => bad('video: https://example.com/a.mp4\ncaptions: /help/videos/a.vtt')).toThrow(/under \/help\/videos/);
    expect(() => bad('video: /help/videos/a.mov\ncaptions: /help/videos/a.vtt')).toThrow(/mp4 or .webm/);
    expect(() => bad('video: /help/videos/a.mp4\ncaptions: /help/videos/a.srt')).toThrow(/must be .vtt/);
  });

  it('rejects what it does not understand instead of guessing', () => {
    expect(() => parseArticleSource('# no front matter\n')).toThrow(FrontmatterError);
    expect(() => parseArticleSource(valid.replace('category: start', 'category: nonsense'))).toThrow(/category/);
    expect(() => parseArticleSource(valid.replace('order: 20', 'order: first'))).toThrow(/order/);
    expect(() => parseArticleSource(valid.replace('order: 20', 'order: 20\norder: 21'))).toThrow(/repeated/);
    expect(() => parseArticleSource(valid.replace('order: 20', 'order: 20\nextra: 1'))).toThrow(/extra/);
    expect(() => parseFrontmatterBlock('title "no colon"')).toThrow(/cannot read/);
    expect(() => parseFrontmatterBlock('keywords: [a, b')).toThrow(/unterminated list/);
    expect(() => parseFrontmatterBlock('title: "open')).toThrow(/unterminated quoted/);
  });

  it('splits the block from the body', () => {
    const { raw, body } = splitFrontmatter('---\na: 1\n---\n\nHello\n');
    expect(raw).toBe('a: 1');
    expect(body).toBe('Hello\n');
  });
});
