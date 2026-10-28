import type { TemplateCanvas, TemplateElement } from '@immersia/shared';

/**
 * Editor state (PHO-4): the template document, the selection and an undo history. Pure, so it is
 * unit-tested without a canvas; the React editor is a thin view over `editorReducer`.
 */

export interface EditorDoc {
  canvas: TemplateCanvas;
  elements: TemplateElement[];
}

// Generic helpers: conditional types distribute over a union only through a type parameter.
type Strip<T> = T extends unknown ? Omit<T, 'id' | 'type'> : never;
type KeysOf<T> = T extends unknown ? keyof T : never;
type ValueOf<T, K extends PropertyKey> = T extends unknown ? (K extends keyof T ? T[K] : never) : never;
type Fields = Strip<TemplateElement>;
/**
 * Any element field except identity and kind, typed by what that field can hold in any element type
 * (an intersection of the element types would be `never`: their `type` literals conflict).
 */
export type ElementPatch = { [K in KeysOf<Fields>]?: ValueOf<Fields, K> };

export interface EditorState {
  doc: EditorDoc;
  /** Selected element ids, in selection order. */
  selection: string[];
  past: EditorDoc[];
  future: EditorDoc[];
  /**
   * Consecutive changes with the same key (one drag, one slider gesture, typing in one field) are
   * one undo step. `commit` ends the run.
   */
  coalesce: string | null;
  /** Bumped on every document change (autosave and canvas redraws watch it). */
  revision: number;
}

export type EditorAction =
  | { type: 'load'; doc: EditorDoc }
  | { type: 'select'; ids: string[] }
  | { type: 'toggleSelect'; id: string }
  | { type: 'selectAll' }
  | { type: 'add'; element: TemplateElement }
  | { type: 'patch'; patches: { id: string; patch: ElementPatch }[]; coalesce?: string }
  | { type: 'remove'; ids: string[] }
  | { type: 'duplicate'; ids: string[]; newIds: string[] }
  | { type: 'arrange'; ids: string[]; to: 'front' | 'back' | 'forward' | 'backward' }
  | { type: 'moveTo'; id: string; index: number }
  | { type: 'canvas'; patch: Partial<TemplateCanvas>; coalesce?: string }
  | { type: 'replace'; doc: EditorDoc }
  | { type: 'commit' }
  | { type: 'undo' }
  | { type: 'redo' };

export const HISTORY_LIMIT = 100;

export function initialEditorState(doc: EditorDoc): EditorState {
  return { doc, selection: [], past: [], future: [], coalesce: null, revision: 0 };
}

/** Apply a document change, recording one undo step unless it continues the current gesture. */
function change(s: EditorState, doc: EditorDoc, coalesce: string | null = null, selection = s.selection): EditorState {
  if (doc === s.doc) return s;
  const continues = coalesce !== null && coalesce === s.coalesce;
  const past = continues ? s.past : [...s.past, s.doc].slice(-HISTORY_LIMIT);
  return {
    doc,
    selection: selection.filter((id) => doc.elements.some((e) => e.id === id)),
    past,
    future: [],
    coalesce,
    revision: s.revision + 1,
  };
}

function patchElement(el: TemplateElement, patch: ElementPatch): TemplateElement {
  const next = { ...el, ...patch } as TemplateElement;
  // Geometry the schema requires (positive sizes, rotation within ±360°, opacity 0–1).
  next.width = Math.max(1, next.width);
  next.height = Math.max(1, next.height);
  next.rotation = ((((next.rotation + 180) % 360) + 360) % 360) - 180;
  next.opacity = Math.min(1, Math.max(0, next.opacity));
  return next;
}

/** Duplicates land a little down and right, so the copy is visibly separate. */
export const duplicateOffset = (canvas: TemplateCanvas) => Math.round(Math.min(canvas.width, canvas.height) * 0.02);

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  const { doc } = s;
  switch (a.type) {
    case 'load':
      return initialEditorState(a.doc);
    case 'select':
      return { ...s, selection: a.ids.filter((id) => doc.elements.some((e) => e.id === id)), coalesce: null };
    case 'toggleSelect':
      return {
        ...s,
        selection: s.selection.includes(a.id) ? s.selection.filter((x) => x !== a.id) : [...s.selection, a.id],
        coalesce: null,
      };
    case 'selectAll':
      return { ...s, selection: doc.elements.filter((e) => !e.locked && !e.hidden).map((e) => e.id), coalesce: null };
    case 'add':
      return change(s, { ...doc, elements: [...doc.elements, a.element] }, null, [a.element.id]);
    case 'patch': {
      const byId = new Map(a.patches.map((p) => [p.id, p.patch]));
      let touched = false;
      const elements = doc.elements.map((el) => {
        const p = byId.get(el.id);
        if (!p) return el;
        touched = true;
        return patchElement(el, p);
      });
      return touched ? change(s, { ...doc, elements }, a.coalesce ?? null) : s;
    }
    case 'remove': {
      const gone = new Set(a.ids);
      const elements = doc.elements.filter((e) => !gone.has(e.id));
      return elements.length === doc.elements.length ? s : change(s, { ...doc, elements });
    }
    case 'duplicate': {
      const off = duplicateOffset(doc.canvas);
      const copies: TemplateElement[] = [];
      a.ids.forEach((id, i) => {
        const el = doc.elements.find((e) => e.id === id);
        const newId = a.newIds[i];
        if (el && newId) copies.push({ ...el, id: newId, x: el.x + off, y: el.y + off, locked: false });
      });
      if (!copies.length) return s;
      return change(
        s,
        { ...doc, elements: [...doc.elements, ...copies] },
        null,
        copies.map((c) => c.id),
      );
    }
    case 'arrange': {
      const moving = new Set(a.ids);
      const list = [...doc.elements];
      if (a.to === 'front' || a.to === 'back') {
        const picked = list.filter((e) => moving.has(e.id));
        const rest = list.filter((e) => !moving.has(e.id));
        const elements = a.to === 'front' ? [...rest, ...picked] : [...picked, ...rest];
        return sameOrder(elements, doc.elements) ? s : change(s, { ...doc, elements });
      }
      // One step: swap each moving element with its neighbour, walking so moves don't collide.
      const order = a.to === 'forward' ? [...list.keys()].reverse() : [...list.keys()];
      for (const i of order) {
        const j = a.to === 'forward' ? i + 1 : i - 1;
        if (!moving.has(list[i]!.id) || j < 0 || j >= list.length || moving.has(list[j]!.id)) continue;
        [list[i], list[j]] = [list[j]!, list[i]!];
      }
      return sameOrder(list, doc.elements) ? s : change(s, { ...doc, elements: list });
    }
    case 'moveTo': {
      const from = doc.elements.findIndex((e) => e.id === a.id);
      const to = Math.max(0, Math.min(doc.elements.length - 1, a.index));
      if (from < 0 || from === to) return s;
      const list = [...doc.elements];
      const [el] = list.splice(from, 1);
      list.splice(to, 0, el!);
      return change(s, { ...doc, elements: list });
    }
    case 'canvas':
      return change(s, { ...doc, canvas: { ...doc.canvas, ...a.patch } }, a.coalesce ?? null);
    case 'replace':
      return change(s, a.doc, null, []);
    case 'commit':
      return s.coalesce === null ? s : { ...s, coalesce: null };
    case 'undo': {
      const prev = s.past.at(-1);
      if (!prev) return s;
      return {
        doc: prev,
        selection: s.selection.filter((id) => prev.elements.some((e) => e.id === id)),
        past: s.past.slice(0, -1),
        future: [s.doc, ...s.future],
        coalesce: null,
        revision: s.revision + 1,
      };
    }
    case 'redo': {
      const [next, ...future] = s.future;
      if (!next) return s;
      return {
        doc: next,
        selection: s.selection.filter((id) => next.elements.some((e) => e.id === id)),
        past: [...s.past, s.doc].slice(-HISTORY_LIMIT),
        future,
        coalesce: null,
        revision: s.revision + 1,
      };
    }
  }
}

function sameOrder(a: TemplateElement[], b: TemplateElement[]) {
  return a.length === b.length && a.every((e, i) => e === b[i]);
}

/** A readable name for the layers panel when the operator hasn't named an element. */
export function elementLabel(el: TemplateElement): {
  kind: TemplateElement['type'];
  text: string | null;
  shot?: number;
} {
  if (el.name) return { kind: el.type, text: el.name };
  if (el.type === 'text') return { kind: 'text', text: el.text.trim().slice(0, 40) || null };
  if (el.type === 'photo') return { kind: 'photo', text: null, shot: el.shot + 1 };
  return { kind: el.type, text: null };
}
