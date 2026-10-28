'use client';

import type { Dispatch } from 'react';
import { useTranslations } from 'next-intl';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Lock,
  LockOpen,
  QrCode,
  Shapes,
  Sparkles,
  Type,
  User,
} from 'lucide-react';
import type { TemplateElement } from '@immersia/shared';
import { IconButton, cx } from '@immersia/ui';
import { elementLabel, type EditorAction } from './state';

const ICONS = { photo: User, image: ImageIcon, text: Type, shape: Shapes, qr: QrCode, ornament: Sparkles } as const;

/** Layers (PHO-4 layer order): topmost first, as in every design tool. */
export function LayersPanel({
  elements,
  selection,
  dispatch,
  assetName,
}: {
  elements: TemplateElement[];
  selection: string[];
  dispatch: Dispatch<EditorAction>;
  assetName: (id: string) => string | null;
}) {
  const t = useTranslations('studio.editor');
  const top = [...elements].reverse();
  if (!elements.length) return <p className="px-4 py-6 text-center text-[13px] text-muted">{t('layers.empty')}</p>;
  return (
    <ul className="space-y-0.5 p-2" aria-label={t('layers.title')}>
      {top.map((el, i) => {
        const Icon = ICONS[el.type];
        const label = elementLabel(el);
        const name =
          label.text ??
          (el.type === 'photo'
            ? t('shotN', { n: label.shot ?? 1 })
            : el.type === 'image'
              ? (assetName(el.assetId) ?? t('types.image'))
              : t(`types.${el.type}`));
        const selected = selection.includes(el.id);
        const index = elements.length - 1 - i;
        return (
          <li
            key={el.id}
            className={cx(
              'group flex items-center gap-1 rounded-lg pr-1 transition-colors',
              selected ? 'bg-accent-soft' : 'hover:bg-sunken',
              el.hidden && 'opacity-60',
            )}
          >
            <button
              type="button"
              aria-pressed={selected}
              onClick={(e) =>
                dispatch(
                  e.shiftKey || e.metaKey || e.ctrlKey
                    ? { type: 'toggleSelect', id: el.id }
                    : { type: 'select', ids: [el.id] },
                )
              }
              className="focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]"
            >
              <Icon className="size-3.5 shrink-0 text-muted" aria-hidden />
              <span className="truncate">{name}</span>
            </button>
            <IconButton
              label={t('layers.up')}
              disabled={index === elements.length - 1}
              onClick={() => dispatch({ type: 'arrange', ids: [el.id], to: 'forward' })}
            >
              <ChevronUp className="size-3.5" aria-hidden />
            </IconButton>
            <IconButton
              label={t('layers.down')}
              disabled={index === 0}
              onClick={() => dispatch({ type: 'arrange', ids: [el.id], to: 'backward' })}
            >
              <ChevronDown className="size-3.5" aria-hidden />
            </IconButton>
            <IconButton
              label={el.hidden ? t('layers.show') : t('layers.hide')}
              onClick={() => dispatch({ type: 'patch', patches: [{ id: el.id, patch: { hidden: !el.hidden } }] })}
            >
              {el.hidden ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
            </IconButton>
            <IconButton
              label={el.locked ? t('layers.unlock') : t('layers.lock')}
              onClick={() => dispatch({ type: 'patch', patches: [{ id: el.id, patch: { locked: !el.locked } }] })}
            >
              {el.locked ? <Lock className="size-3.5" aria-hidden /> : <LockOpen className="size-3.5" aria-hidden />}
            </IconButton>
          </li>
        );
      })}
    </ul>
  );
}
