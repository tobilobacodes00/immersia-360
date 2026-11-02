import { describe, expect, it } from 'vitest';
import type { TemplateElement } from '@immersia/shared';
import { HISTORY_LIMIT, editorReducer, initialEditorState, type EditorAction, type EditorDoc } from './state';

const shape = (id: string, x = 0): TemplateElement => ({
  id,
  type: 'shape',
  shape: 'rect',
  x,
  y: 0,
  width: 100,
  height: 50,
  rotation: 0,
  opacity: 1,
  locked: false,
  hidden: false,
  fill: '#111110',
  stroke: null,
  strokeWidth: 0,
  cornerRadius: 0,
});

const doc = (...elements: TemplateElement[]): EditorDoc => ({
  canvas: { width: 600, height: 1800, dpi: 300, printSize: '2x6', background: '#ffffff', backgroundAssetId: null },
  elements,
});

const run = (actions: EditorAction[], start = doc(shape('a'), shape('b'), shape('c'))) =>
  actions.reduce(editorReducer, initialEditorState(start));

const ids = (s: ReturnType<typeof run>) => s.doc.elements.map((e) => e.id);
const xOf = (s: ReturnType<typeof run>, id: string) => s.doc.elements.find((e) => e.id === id)!.x;

describe('editor history (PHO-4 undo/redo)', () => {
  it('undoes and redoes discrete changes', () => {
    const s = run([{ type: 'remove', ids: ['b'] }, { type: 'undo' }]);
    expect(ids(s)).toEqual(['a', 'b', 'c']);
    expect(ids(editorReducer(s, { type: 'redo' }))).toEqual(['a', 'c']);
  });

  it('one gesture is one undo step; a commit starts the next', () => {
    const drag = (x: number): EditorAction => ({
      type: 'patch',
      patches: [{ id: 'a', patch: { x } }],
      coalesce: 'drag:a',
    });
    const s = run([drag(10), drag(20), drag(30), { type: 'commit' }, drag(40), { type: 'commit' }]);
    expect(xOf(s, 'a')).toBe(40);
    const once = editorReducer(s, { type: 'undo' });
    expect(xOf(once, 'a')).toBe(30);
    expect(xOf(editorReducer(once, { type: 'undo' }), 'a')).toBe(0);
  });

  it('a new change clears the redo stack', () => {
    const s = run([{ type: 'remove', ids: ['a'] }, { type: 'undo' }, { type: 'remove', ids: ['b'] }]);
    expect(s.future).toEqual([]);
    expect(editorReducer(s, { type: 'redo' })).toBe(s);
  });

  it('keeps at most HISTORY_LIMIT steps', () => {
    const many = Array.from({ length: HISTORY_LIMIT + 20 }, (_, i): EditorAction => ({
      type: 'patch',
      patches: [{ id: 'a', patch: { x: i + 1 } }],
    }));
    const s = run(many);
    expect(s.past).toHaveLength(HISTORY_LIMIT);
  });

  it('no-op actions record nothing', () => {
    const s = run([
      { type: 'patch', patches: [{ id: 'missing', patch: { x: 5 } }] },
      { type: 'arrange', ids: ['c'], to: 'front' },
    ]);
    expect(s.past).toHaveLength(0);
    expect(s.revision).toBe(0);
  });

  it('undo drops selected ids that no longer exist', () => {
    const s = run([{ type: 'add', element: shape('d') }, { type: 'undo' }]);
    expect(s.selection).toEqual([]);
  });
});

describe('editor edits', () => {
  it('adds and selects the new element', () => {
    const s = run([{ type: 'add', element: shape('d') }]);
    expect(ids(s)).toEqual(['a', 'b', 'c', 'd']);
    expect(s.selection).toEqual(['d']);
  });

  it('duplicates with an offset and selects the copies', () => {
    const s = run([{ type: 'duplicate', ids: ['a'], newIds: ['a2'] }]);
    expect(ids(s)).toEqual(['a', 'b', 'c', 'a2']);
    expect(xOf(s, 'a2')).toBe(12); // 2% of the 600 px short side
    expect(s.selection).toEqual(['a2']);
  });

  it('arranges layers', () => {
    expect(ids(run([{ type: 'arrange', ids: ['a'], to: 'front' }]))).toEqual(['b', 'c', 'a']);
    expect(ids(run([{ type: 'arrange', ids: ['c'], to: 'back' }]))).toEqual(['c', 'a', 'b']);
    expect(ids(run([{ type: 'arrange', ids: ['a'], to: 'forward' }]))).toEqual(['b', 'a', 'c']);
    expect(ids(run([{ type: 'arrange', ids: ['c'], to: 'backward' }]))).toEqual(['a', 'c', 'b']);
    // Neighbours moving together keep their relative order.
    expect(ids(run([{ type: 'arrange', ids: ['a', 'b'], to: 'forward' }]))).toEqual(['c', 'a', 'b']);
    expect(ids(run([{ type: 'moveTo', id: 'a', index: 2 }]))).toEqual(['b', 'c', 'a']);
  });

  it('keeps geometry valid', () => {
    const s = run([{ type: 'patch', patches: [{ id: 'a', patch: { width: -5, rotation: 270, opacity: 2 } }] }]);
    const a = s.doc.elements[0]!;
    expect(a.width).toBe(1);
    expect(a.rotation).toBe(-90);
    expect(a.opacity).toBe(1);
  });

  it('select-all skips locked and hidden elements', () => {
    const start = doc(shape('a'), { ...shape('b'), locked: true }, { ...shape('c'), hidden: true });
    expect(run([{ type: 'selectAll' }], start).selection).toEqual(['a']);
  });
});
