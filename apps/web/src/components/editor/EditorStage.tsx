'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import { Group, Layer, Line, Rect, Shape, Stage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { drawElementContent, drawFitted, type RenderInputs } from '@immersia/layout';
import type { TemplateElement } from '@immersia/shared';
import { rotatedBounds, snapMove, snapPoint, type Box, type Guide } from './snap';
import type { EditorAction, EditorDoc } from './state';

/** Screen-pixel distance within which things snap; converted to canvas pixels at the current zoom. */
const SNAP_PX = 6;
const PAD = 32;
const ROTATION_SNAPS = [0, 45, 90, 135, 180, 225, 270, 315];

export interface StageProps {
  doc: EditorDoc;
  selection: string[];
  dispatch: Dispatch<EditorAction>;
  inputs: RenderInputs;
  /** Changes whenever fonts or images finish loading: everything must be redrawn. */
  redrawKey: number;
  /** 'fit', or canvas-to-screen scale (1 = 100 %). */
  zoom: number | 'fit';
  onFitScale: (scale: number) => void;
  /** Transparent canvases (overlays) show a checkerboard behind them. */
  transparent: boolean;
  guidesColor: string;
  selectionColor: string;
  onEditText: (id: string) => void;
  label: string;
}

const boxOf = (el: TemplateElement): Box => rotatedBounds(el, el.rotation);

/** A checkerboard tile for transparent canvases, built once. */
function checkerTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#e7e5df';
  g.fillRect(0, 0, 8, 8);
  g.fillRect(8, 8, 8, 8);
  return c;
}

export default function EditorStage(p: StageProps) {
  const { doc, selection, dispatch, inputs, zoom } = p;
  const { width: W, height: H } = doc.canvas;
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Konva.Stage>(null);
  const transformer = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const marqueeStart = useRef<{ x: number; y: number; additive: boolean } | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry!.contentRect;
      setSize({ width: Math.floor(r.width), height: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // This component only runs in the browser (loaded without SSR), so document exists here.
  const checker = useMemo(() => (p.transparent ? checkerTile() : null), [p.transparent]);

  const fit =
    size.width && size.height ? Math.max(0.02, Math.min((size.width - 2 * PAD) / W, (size.height - 2 * PAD) / H)) : 0;
  const { onFitScale } = p;
  useEffect(() => {
    if (fit) onFitScale(fit);
  }, [fit, onFitScale]);
  const scale = zoom === 'fit' ? fit : zoom;
  // The stage grows past the viewport when zoomed in; the host scrolls.
  const stageW = Math.max(size.width, Math.ceil(W * scale + 2 * PAD));
  const stageH = Math.max(size.height, Math.ceil(H * scale + 2 * PAD));
  const ox = Math.round((stageW - W * scale) / 2);
  const oy = Math.round((stageH - H * scale) / 2);

  const visible = useMemo(() => doc.elements.filter((e) => !e.hidden), [doc.elements]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);

  // Attach the transformer to the selected, unlocked nodes.
  useEffect(() => {
    const tr = transformer.current;
    const st = stage.current;
    if (!tr || !st) return;
    const nodes = selection
      .map((id) => doc.elements.find((e) => e.id === id))
      .filter((e): e is TemplateElement => !!e && !e.locked && !e.hidden)
      .map((e) => st.findOne<Konva.Shape>(`#el-${e.id}`))
      .filter((n): n is Konva.Shape => !!n);
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selection, doc.elements]);

  // Fonts and images arrive after the first paint: redraw what's on screen.
  useEffect(() => {
    stage.current?.batchDraw();
  }, [p.redrawKey]);

  const toCanvas = useCallback(
    (abs: { x: number; y: number }) => ({ x: (abs.x - ox) / scale, y: (abs.y - oy) / scale }),
    [ox, oy, scale],
  );

  const others = useCallback((exclude: Set<string>) => visible.filter((e) => !exclude.has(e.id)).map(boxOf), [visible]);

  const onDragMove = (el: TemplateElement, node: Konva.Shape) => {
    // Several elements move together through the transformer; snapping is for a single element.
    if (selection.length > 1 && selectedSet.has(el.id)) return setGuides([]);
    const box = rotatedBounds(
      { x: node.x() - el.width / 2, y: node.y() - el.height / 2, width: el.width, height: el.height },
      node.rotation(),
    );
    const snap = snapMove(box, others(new Set([el.id])), doc.canvas, SNAP_PX / scale);
    if (snap.dx || snap.dy) node.position({ x: node.x() + snap.dx, y: node.y() + snap.dy });
    setGuides(snap.guides);
  };

  const onDragEnd = () => {
    setGuides([]);
    const st = stage.current;
    if (!st) return;
    // Everything that moved (a multi-selection moves together) is one undo step.
    const ids = new Set(selection);
    const patches = doc.elements
      .filter((e) => ids.has(e.id))
      .map((e) => {
        const n = st.findOne<Konva.Shape>(`#el-${e.id}`);
        return n ? { id: e.id, patch: { x: round(n.x() - e.width / 2), y: round(n.y() - e.height / 2) } } : null;
      })
      .filter((x) => x !== null);
    if (patches.length) dispatch({ type: 'patch', patches });
  };

  const onTransformEnd = () => {
    setGuides([]);
    const tr = transformer.current;
    if (!tr) return;
    const patches = tr.nodes().map((n) => {
      const id = n.id().slice(3);
      const w = Math.max(1, n.width() * n.scaleX());
      const h = Math.max(1, n.height() * n.scaleY());
      // Size lives in width/height, never in a scale: text keeps its font size, strokes their width.
      n.scale({ x: 1, y: 1 });
      return {
        id,
        patch: {
          x: round(n.x() - w / 2),
          y: round(n.y() - h / 2),
          width: round(w),
          height: round(h),
          rotation: round(n.rotation()),
        },
      };
    });
    dispatch({ type: 'patch', patches });
  };

  const single = selection.length === 1 ? doc.elements.find((e) => e.id === selection[0]) : undefined;
  const anchorDragBoundFunc = (_old: Konva.Vector2d, next: Konva.Vector2d) => {
    // Resize handles snap only for one unrotated element (rotated edges don't lie on guides).
    if (!single || single.rotation) return next;
    const snap = snapPoint(toCanvas(next), others(new Set([single.id])), doc.canvas, SNAP_PX / scale);
    setGuides(snap.guides);
    return { x: snap.x * scale + ox, y: snap.y * scale + oy };
  };

  const onStageDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const target = e.target;
    const onEmpty = target === target.getStage() || target.name() === 'canvas-bg';
    if (!onEmpty) return;
    const pos = target.getStage()?.getPointerPosition();
    if (!pos) return;
    const additive = 'shiftKey' in e.evt && (e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey);
    marqueeStart.current = { ...toCanvas(pos), additive };
    if (!additive) dispatch({ type: 'select', ids: [] });
  };

  const onStageMove = () => {
    const start = marqueeStart.current;
    const pos = stage.current?.getPointerPosition();
    if (!start || !pos) return;
    const now = toCanvas(pos);
    setMarquee({
      x: Math.min(start.x, now.x),
      y: Math.min(start.y, now.y),
      width: Math.abs(now.x - start.x),
      height: Math.abs(now.y - start.y),
    });
  };

  const onStageUp = () => {
    const start = marqueeStart.current;
    marqueeStart.current = null;
    if (!start || !marquee) return setMarquee(null);
    const m = marquee;
    setMarquee(null);
    if (m.width < 2 && m.height < 2) return;
    const hit = visible
      .filter((e) => !e.locked)
      .filter((e) => {
        const b = boxOf(e);
        return b.x < m.x + m.width && m.x < b.x + b.width && b.y < m.y + m.height && m.y < b.y + b.height;
      })
      .map((e) => e.id);
    dispatch({ type: 'select', ids: start.additive ? [...new Set([...selection, ...hit])] : hit });
  };

  const onElementDown = (el: TemplateElement, e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const additive = 'shiftKey' in e.evt && (e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey);
    if (additive) dispatch({ type: 'toggleSelect', id: el.id });
    else if (!selectedSet.has(el.id)) dispatch({ type: 'select', ids: [el.id] });
  };

  const keepRatio = single?.type === 'qr' || (single?.type === 'image' && single.fit === 'contain');

  return (
    <div
      ref={host}
      className="focus-ring relative h-full min-h-[320px] w-full overflow-auto overscroll-contain bg-sunken"
      role="application"
      aria-label={p.label}
      // Focusable, so keyboard users can reach the canvas and its shortcuts (and scroll it when zoomed).
      tabIndex={0}
    >
      {size.width > 0 && (
        <Stage
          ref={stage}
          width={stageW}
          height={stageH}
          onMouseDown={onStageDown}
          onTouchStart={onStageDown}
          onMouseMove={onStageMove}
          onTouchMove={onStageMove}
          onMouseUp={onStageUp}
          onTouchEnd={onStageUp}
        >
          <Layer>
            <Group x={ox} y={oy} scaleX={scale} scaleY={scale}>
              {p.transparent && checker && (
                <Rect
                  width={W}
                  height={H}
                  fillPatternImage={checker as unknown as HTMLImageElement}
                  fillPatternScale={{ x: 1 / scale, y: 1 / scale }}
                  listening={false}
                />
              )}
              <Rect
                name="canvas-bg"
                width={W}
                height={H}
                fill={doc.canvas.background}
                shadowColor="#111110"
                shadowOpacity={0.12}
                shadowBlur={24 / scale}
              />
              {doc.canvas.backgroundAssetId && (
                <Shape
                  listening={false}
                  sceneFunc={(ctx) => {
                    const img = inputs.assets?.(doc.canvas.backgroundAssetId!);
                    if (img) drawFitted(ctx._context, img, W, H, 'cover');
                  }}
                />
              )}
              {/* What lies outside the canvas doesn't print: clip it, as the renderer does. */}
              <Group clipX={0} clipY={0} clipWidth={W} clipHeight={H}>
                {doc.elements.map((el) => (
                  <Shape
                    key={el.id}
                    id={`el-${el.id}`}
                    x={el.x + el.width / 2}
                    y={el.y + el.height / 2}
                    width={el.width}
                    height={el.height}
                    offsetX={el.width / 2}
                    offsetY={el.height / 2}
                    rotation={el.rotation}
                    opacity={el.opacity}
                    visible={!el.hidden}
                    listening={!el.locked}
                    draggable={!el.locked}
                    sceneFunc={(ctx) => drawElementContent(ctx._context, el, inputs)}
                    hitFunc={(ctx, shape) => {
                      ctx.beginPath();
                      ctx.rect(0, 0, shape.width(), shape.height());
                      ctx.closePath();
                      ctx.fillStrokeShape(shape);
                    }}
                    onMouseDown={(e) => onElementDown(el, e)}
                    onTouchStart={(e) => onElementDown(el, e)}
                    onDblClick={() => el.type === 'text' && p.onEditText(el.id)}
                    onDblTap={() => el.type === 'text' && p.onEditText(el.id)}
                    onDragMove={(e) => onDragMove(el, e.target as Konva.Shape)}
                    onDragEnd={onDragEnd}
                  />
                ))}
              </Group>
            </Group>
          </Layer>
          <Layer>
            <Group x={ox} y={oy} scaleX={scale} scaleY={scale} listening={false}>
              {guides.map((g, i) => (
                <Line
                  key={i}
                  points={g.orientation === 'v' ? [g.at, g.from, g.at, g.to] : [g.from, g.at, g.to, g.at]}
                  stroke={p.guidesColor}
                  strokeWidth={1 / scale}
                  dash={[4 / scale, 4 / scale]}
                />
              ))}
              {marquee && (
                <Rect {...marquee} stroke={p.selectionColor} strokeWidth={1 / scale} fill={`${p.selectionColor}14`} />
              )}
            </Group>
            <Transformer
              ref={transformer}
              rotationSnaps={ROTATION_SNAPS}
              rotationSnapTolerance={4}
              keepRatio={keepRatio}
              flipEnabled={false}
              ignoreStroke
              anchorSize={9}
              borderStroke={p.selectionColor}
              anchorStroke={p.selectionColor}
              anchorCornerRadius={2}
              boundBoxFunc={(old, next) => (Math.abs(next.width) < 4 || Math.abs(next.height) < 4 ? old : next)}
              anchorDragBoundFunc={anchorDragBoundFunc}
              onTransformEnd={onTransformEnd}
            />
          </Layer>
        </Stage>
      )}
    </div>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;
