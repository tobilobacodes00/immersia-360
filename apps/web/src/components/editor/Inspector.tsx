'use client';

import { useState, type Dispatch } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Copy,
  ImageIcon,
  Trash2,
} from 'lucide-react';
import type { TemplateElement, TokenContext } from '@immersia/shared';
import {
  Button,
  IconButton,
  NumberInput,
  Segmented,
  Select,
  Slider,
  TextInput,
  Toggle,
  TokenField,
} from '@immersia/ui';
import { AssetPicker } from '@/components/assets/AssetPicker';
import type { AssetView } from '@/server/assets';
import { AlphaColorField, Row, Section } from './fields';
import { FontPicker, weightsOf } from './FontPicker';
import { OrnamentPicker, OrnamentSwatch } from './OrnamentPicker';
import type { EditorAction, EditorDoc, ElementPatch } from './state';

type AssetType = AssetView['type'];

export interface InspectorProps {
  kind: 'layout' | 'overlay';
  doc: EditorDoc;
  selection: string[];
  dispatch: Dispatch<EditorAction>;
  tokens: TokenContext;
  fonts: AssetView[];
  /** A picked asset joins the editor's asset map so it can be drawn right away. */
  onAsset: (a: AssetView) => void;
  assetName: (id: string) => string | null;
  textFieldId: (id: string) => string;
  onDuplicate: (ids: string[]) => void;
}

const BACKGROUND_TYPES: AssetType[] = ['background', 'layout', 'overlay'];
const IMAGE_TYPES: AssetType[] = ['overlay', 'layout', 'logo', 'background'];

export function Inspector(p: InspectorProps) {
  const t = useTranslations('studio.editor');
  const { doc, selection } = p;
  const selected = doc.elements.filter((e) => selection.includes(e.id));
  const [picker, setPicker] = useState<null | {
    types: AssetType[];
    onPick: (a: AssetView) => void;
    selectedId?: string | null;
  }>(null);

  // One picker serves the canvas background and image elements.
  const picked = (a: AssetView, apply: (a: AssetView) => void) => {
    p.onAsset(a);
    apply(a);
    setPicker(null);
  };

  let body;
  if (selected.length === 0) body = <CanvasPanel {...p} openPicker={setPicker} />;
  else if (selected.length > 1) body = <MultiPanel {...p} selected={selected} />;
  else body = <ElementPanel {...p} el={selected[0]!} openPicker={setPicker} />;

  return (
    <div className="text-sm">
      {body}
      <AssetPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        types={picker?.types ?? IMAGE_TYPES}
        selectedId={picker?.selectedId ?? null}
        title={t('pickImage')}
        onPick={(a) => picker && picked(a, picker.onPick)}
      />
    </div>
  );
}

type PickerOpener = (o: { types: AssetType[]; onPick: (a: AssetView) => void; selectedId?: string | null }) => void;

function CanvasPanel(p: InspectorProps & { openPicker: PickerOpener }) {
  const t = useTranslations('studio.editor');
  const c = p.doc.canvas;
  const transparent = p.kind === 'overlay';
  return (
    <>
      <Section title={t('canvas.title')}>
        <Row label={t('canvas.size')}>
          <span className="tabular text-[13px] text-fg">
            {c.printSize && c.printSize !== 'story' ? t(`printSizes.${c.printSize}`) : `${c.width} × ${c.height}`}
          </span>
        </Row>
        {c.printSize && c.printSize !== 'story' && (
          <p className="pb-1 text-[12px] leading-relaxed text-faint">
            {t('canvas.dpi', { width: c.width, height: c.height })}
          </p>
        )}
      </Section>
      <Section title={t('canvas.background')}>
        <div className="py-1">
          <AlphaColorField
            value={c.background}
            label={t('canvas.backgroundColour')}
            alphaLabel={t('fields.opacity')}
            onChange={(v, gesture) =>
              p.dispatch({ type: 'canvas', patch: { background: v }, coalesce: gesture ? 'bg' : undefined })
            }
          />
          {transparent && <p className="mt-2 text-[12px] leading-relaxed text-faint">{t('canvas.overlayHint')}</p>}
        </div>
        <Row label={t('canvas.backgroundImage')}>
          <Button
            size="sm"
            onClick={() =>
              p.openPicker({
                types: BACKGROUND_TYPES,
                selectedId: c.backgroundAssetId,
                onPick: (a) => p.dispatch({ type: 'canvas', patch: { backgroundAssetId: a.id } }),
              })
            }
          >
            <ImageIcon className="size-3.5" aria-hidden />
            {c.backgroundAssetId ? (p.assetName(c.backgroundAssetId) ?? t('canvas.replace')) : t('canvas.choose')}
          </Button>
          {c.backgroundAssetId && (
            <IconButton
              label={t('canvas.removeImage')}
              onClick={() => p.dispatch({ type: 'canvas', patch: { backgroundAssetId: null } })}
            >
              <Trash2 className="size-4" aria-hidden />
            </IconButton>
          )}
        </Row>
      </Section>
      <p className="px-4 py-3 text-[12px] leading-relaxed text-faint">{t('canvas.tip')}</p>
    </>
  );
}

function align(
  els: TemplateElement[],
  edge: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom',
  bounds: { x: number; y: number; width: number; height: number },
) {
  return els.map((e) => {
    const patch: ElementPatch = {};
    if (edge === 'left') patch.x = bounds.x;
    if (edge === 'hcenter') patch.x = bounds.x + (bounds.width - e.width) / 2;
    if (edge === 'right') patch.x = bounds.x + bounds.width - e.width;
    if (edge === 'top') patch.y = bounds.y;
    if (edge === 'vcenter') patch.y = bounds.y + (bounds.height - e.height) / 2;
    if (edge === 'bottom') patch.y = bounds.y + bounds.height - e.height;
    return { id: e.id, patch };
  });
}

const ALIGN = [
  { edge: 'left', icon: AlignStartVertical },
  { edge: 'hcenter', icon: AlignCenterVertical },
  { edge: 'right', icon: AlignEndVertical },
  { edge: 'top', icon: AlignStartHorizontal },
  { edge: 'vcenter', icon: AlignCenterHorizontal },
  { edge: 'bottom', icon: AlignEndHorizontal },
] as const;

function AlignTools({
  els,
  canvas,
  dispatch,
}: {
  els: TemplateElement[];
  canvas: EditorDoc['canvas'];
  dispatch: Dispatch<EditorAction>;
}) {
  const t = useTranslations('studio.editor.align');
  // One element aligns to the canvas; several align to their shared bounds.
  const bounds =
    els.length === 1
      ? { x: 0, y: 0, width: canvas.width, height: canvas.height }
      : (() => {
          const x = Math.min(...els.map((e) => e.x));
          const y = Math.min(...els.map((e) => e.y));
          return {
            x,
            y,
            width: Math.max(...els.map((e) => e.x + e.width)) - x,
            height: Math.max(...els.map((e) => e.y + e.height)) - y,
          };
        })();
  return (
    <div className="flex flex-wrap gap-0.5" role="group" aria-label={t('label')}>
      {ALIGN.map(({ edge, icon: Icon }) => (
        <IconButton
          key={edge}
          label={t(edge)}
          onClick={() => dispatch({ type: 'patch', patches: align(els, edge, bounds) })}
        >
          <Icon className="size-4" aria-hidden />
        </IconButton>
      ))}
    </div>
  );
}

function MultiPanel(p: InspectorProps & { selected: TemplateElement[] }) {
  const t = useTranslations('studio.editor');
  const ids = p.selected.map((e) => e.id);
  return (
    <>
      <Section title={t('multi.title', { count: p.selected.length })}>
        <div className="py-1">
          <AlignTools els={p.selected} canvas={p.doc.canvas} dispatch={p.dispatch} />
        </div>
      </Section>
      <Section title={t('multi.actions')}>
        <div className="flex flex-wrap gap-2 py-1">
          <Button size="sm" onClick={() => p.onDuplicate(ids)}>
            <Copy className="size-3.5" aria-hidden /> {t('actions.duplicate')}
          </Button>
          <Button size="sm" variant="danger" onClick={() => p.dispatch({ type: 'remove', ids })}>
            <Trash2 className="size-3.5" aria-hidden /> {t('actions.delete')}
          </Button>
        </div>
      </Section>
    </>
  );
}

function ElementPanel(p: InspectorProps & { el: TemplateElement; openPicker: PickerOpener }) {
  const t = useTranslations('studio.editor');
  const { el, dispatch } = p;
  const [ornamentOpen, setOrnamentOpen] = useState(false);
  const set = (patch: ElementPatch, coalesce?: string) =>
    dispatch({
      type: 'patch',
      patches: [{ id: el.id, patch }],
      coalesce: coalesce ? `${coalesce}:${el.id}` : undefined,
    });
  const num = (key: 'x' | 'y' | 'width' | 'height', label: string) => (
    <label className="flex items-center gap-1.5 text-[12px] text-faint">
      <span className="w-3 shrink-0">{label}</span>
      <NumberInput
        value={Math.round(el[key] * 10) / 10}
        min={key === 'width' || key === 'height' ? 1 : undefined}
        onChange={(v) => {
          const patch: ElementPatch = {};
          patch[key] = v;
          set(patch);
        }}
        label={t(`fields.${key}`)}
        className="w-full"
      />
    </label>
  );

  return (
    <>
      <Section
        title={t(`types.${el.type}`)}
        action={
          <div className="flex gap-0.5">
            <IconButton label={t('actions.duplicate')} onClick={() => p.onDuplicate([el.id])}>
              <Copy className="size-4" aria-hidden />
            </IconButton>
            <IconButton label={t('actions.delete')} onClick={() => dispatch({ type: 'remove', ids: [el.id] })}>
              <Trash2 className="size-4" aria-hidden />
            </IconButton>
          </div>
        }
      >
        <Row label={t('fields.name')}>
          <TextInput
            value={el.name ?? ''}
            placeholder={t('fields.namePlaceholder')}
            ariaLabel={t('fields.name')}
            className="w-40"
            onChange={(v) => set({ name: v.slice(0, 80) || undefined }, 'name')}
          />
        </Row>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 py-2">
          {num('x', 'X')}
          {num('y', 'Y')}
          {num('width', 'W')}
          {num('height', 'H')}
        </div>
        <Row label={t('fields.rotation')}>
          <NumberInput
            value={Math.round(el.rotation * 10) / 10}
            min={-180}
            max={180}
            unit="°"
            onChange={(v) => set({ rotation: v })}
            label={t('fields.rotation')}
          />
        </Row>
        <Row label={t('fields.opacity')}>
          <Slider
            value={Math.round(el.opacity * 100)}
            min={0}
            max={100}
            unit="%"
            width="w-44"
            label={t('fields.opacity')}
            onChange={(v) => set({ opacity: v / 100 }, 'opacity')}
          />
        </Row>
        <div className="py-1">
          <AlignTools els={[el]} canvas={p.doc.canvas} dispatch={dispatch} />
        </div>
      </Section>

      {el.type === 'text' && (
        <Section title={t('sections.text')}>
          <div className="py-1" id={p.textFieldId(el.id)}>
            <TokenField
              label={t('fields.text')}
              multiline
              value={el.text}
              ctx={p.tokens}
              onChange={(v) => set({ text: v.slice(0, 500) }, 'text')}
            />
          </div>
          <div className="py-1.5">
            <FontPicker
              value={el.fontFamily}
              uploaded={p.fonts}
              onChange={(family) => {
                const weights = weightsOf(family);
                const fontWeight = weights.reduce((a, b) =>
                  Math.abs(b - el.fontWeight) < Math.abs(a - el.fontWeight) ? b : a,
                );
                set({ fontFamily: family, fontWeight });
              }}
            />
          </div>
          <Row label={t('fields.weight')}>
            <Select
              value={String(el.fontWeight)}
              label={t('fields.weight')}
              options={weightsOf(el.fontFamily).map((w) => ({
                value: String(w),
                label: t(`weights.${w}` as 'weights.400'),
              }))}
              onChange={(v) => set({ fontWeight: Number(v) })}
            />
          </Row>
          <Row label={t('fields.fontSize')}>
            <NumberInput
              value={Math.round(el.fontSize * 10) / 10}
              min={4}
              max={2000}
              unit="px"
              onChange={(v) => set({ fontSize: v })}
              label={t('fields.fontSize')}
            />
          </Row>
          <Row label={t('fields.lineHeight')}>
            <NumberInput
              value={el.lineHeight}
              min={0.6}
              max={3}
              step={0.05}
              onChange={(v) => set({ lineHeight: v })}
              label={t('fields.lineHeight')}
            />
          </Row>
          <Row label={t('fields.letterSpacing')}>
            <NumberInput
              value={Math.round(el.letterSpacing * 10) / 10}
              min={-200}
              max={500}
              unit="px"
              onChange={(v) => set({ letterSpacing: v })}
              label={t('fields.letterSpacing')}
            />
          </Row>
          <div className="py-1.5">
            <AlphaColorField
              value={el.color}
              label={t('fields.colour')}
              alphaLabel={t('fields.colourOpacity')}
              onChange={(v, g) => set({ color: v }, g ? 'colour' : undefined)}
            />
          </div>
          <Row label={t('fields.align')}>
            <Segmented
              size="sm"
              value={el.align}
              label={t('fields.align')}
              onChange={(v) => set({ align: v })}
              options={(['left', 'center', 'right'] as const).map((v) => ({ value: v, label: t(`alignText.${v}`) }))}
            />
          </Row>
          <Row label={t('fields.verticalAlign')}>
            <Segmented
              size="sm"
              value={el.verticalAlign}
              label={t('fields.verticalAlign')}
              onChange={(v) => set({ verticalAlign: v })}
              options={(['top', 'middle', 'bottom'] as const).map((v) => ({ value: v, label: t(`alignText.${v}`) }))}
            />
          </Row>
          <Row label={t('fields.uppercase')}>
            <Toggle checked={el.uppercase} onChange={(v) => set({ uppercase: v })} label={t('fields.uppercase')} />
          </Row>
          <Row label={t('fields.autoFit')}>
            <Toggle checked={el.autoFit} onChange={(v) => set({ autoFit: v })} label={t('fields.autoFit')} />
          </Row>
        </Section>
      )}

      {el.type === 'photo' && (
        <Section title={t('sections.photo')}>
          <Row label={t('fields.shot')}>
            <Select
              value={String(el.shot)}
              label={t('fields.shot')}
              options={[0, 1, 2, 3].map((s) => ({ value: String(s), label: t('shotN', { n: s + 1 }) }))}
              onChange={(v) => set({ shot: Number(v) })}
            />
          </Row>
          <Row label={t('fields.fit')}>
            <Segmented
              size="sm"
              value={el.fit}
              label={t('fields.fit')}
              onChange={(v) => set({ fit: v })}
              options={(['cover', 'contain'] as const).map((v) => ({ value: v, label: t(`fit.${v}`) }))}
            />
          </Row>
          <Row label={t('fields.cornerRadius')}>
            <NumberInput
              value={el.cornerRadius}
              min={0}
              max={2000}
              unit="px"
              onChange={(v) => set({ cornerRadius: v })}
              label={t('fields.cornerRadius')}
            />
          </Row>
        </Section>
      )}

      {el.type === 'image' && (
        <Section title={t('sections.image')}>
          <Row label={t('fields.asset')}>
            <Button
              size="sm"
              onClick={() =>
                p.openPicker({ types: IMAGE_TYPES, selectedId: el.assetId, onPick: (a) => set({ assetId: a.id }) })
              }
            >
              <ImageIcon className="size-3.5" aria-hidden />
              <span className="max-w-32 truncate">{p.assetName(el.assetId) ?? t('canvas.choose')}</span>
            </Button>
          </Row>
          <Row label={t('fields.fit')}>
            <Segmented
              size="sm"
              value={el.fit}
              label={t('fields.fit')}
              onChange={(v) => set({ fit: v })}
              options={(['cover', 'contain'] as const).map((v) => ({ value: v, label: t(`fit.${v}`) }))}
            />
          </Row>
        </Section>
      )}

      {el.type === 'shape' && (
        <Section title={t('sections.shape')}>
          <Row label={t('fields.shape')}>
            <Segmented
              size="sm"
              value={el.shape}
              label={t('fields.shape')}
              onChange={(v) => set({ shape: v })}
              options={(['rect', 'ellipse'] as const).map((v) => ({ value: v, label: t(`shapes.${v}`) }))}
            />
          </Row>
          <div className="py-1.5">
            <AlphaColorField
              value={el.fill}
              label={t('fields.fill')}
              alphaLabel={t('fields.fillOpacity')}
              onChange={(v, g) => set({ fill: v }, g ? 'fill' : undefined)}
            />
          </div>
          <Row label={t('fields.stroke')}>
            <Toggle
              checked={el.stroke !== null}
              onChange={(on) =>
                set({ stroke: on ? '#111110' : null, strokeWidth: on ? Math.max(el.strokeWidth, 4) : 0 })
              }
              label={t('fields.stroke')}
            />
          </Row>
          {el.stroke !== null && (
            <>
              <div className="py-1.5">
                <AlphaColorField
                  value={el.stroke}
                  label={t('fields.strokeColour')}
                  alphaLabel={t('fields.strokeOpacity')}
                  onChange={(v, g) => set({ stroke: v }, g ? 'stroke' : undefined)}
                />
              </div>
              <Row label={t('fields.strokeWidth')}>
                <NumberInput
                  value={el.strokeWidth}
                  min={0}
                  max={500}
                  unit="px"
                  onChange={(v) => set({ strokeWidth: v })}
                  label={t('fields.strokeWidth')}
                />
              </Row>
            </>
          )}
          {el.shape === 'rect' && (
            <Row label={t('fields.cornerRadius')}>
              <NumberInput
                value={el.cornerRadius}
                min={0}
                max={2000}
                unit="px"
                onChange={(v) => set({ cornerRadius: v })}
                label={t('fields.cornerRadius')}
              />
            </Row>
          )}
        </Section>
      )}

      {el.type === 'ornament' && (
        <Section title={t('sections.ornament')}>
          <Row label={t('fields.ornament')}>
            <Button size="sm" onClick={() => setOrnamentOpen(true)}>
              <OrnamentSwatch name={el.ornament} size={18} />
              {t(`ornaments.names.${el.ornament}`)}
            </Button>
          </Row>
          <div className="py-1.5">
            <AlphaColorField
              value={el.color}
              label={t('fields.colour')}
              alphaLabel={t('fields.colourOpacity')}
              onChange={(v, g) => set({ color: v }, g ? 'colour' : undefined)}
            />
          </div>
          <OrnamentPicker
            open={ornamentOpen}
            selected={el.ornament}
            onClose={() => setOrnamentOpen(false)}
            onPick={(ornament) => {
              setOrnamentOpen(false);
              set({ ornament });
            }}
          />
        </Section>
      )}

      {el.type === 'qr' && (
        <Section title={t('sections.qr')}>
          <div className="space-y-2 py-1.5">
            <AlphaColorField
              value={el.dark}
              label={t('fields.qrDark')}
              alphaLabel={t('fields.qrDarkOpacity')}
              onChange={(v) => set({ dark: v })}
            />
            <AlphaColorField
              value={el.light}
              label={t('fields.qrLight')}
              alphaLabel={t('fields.qrLightOpacity')}
              onChange={(v) => set({ light: v })}
            />
          </div>
          <Row label={t('fields.showCode')}>
            <Toggle checked={el.showCode} onChange={(v) => set({ showCode: v })} label={t('fields.showCode')} />
          </Row>
          {p.kind === 'layout' && <p className="pb-1 text-[12px] leading-relaxed text-faint">{t('qrHint')}</p>}
        </Section>
      )}
    </>
  );
}
