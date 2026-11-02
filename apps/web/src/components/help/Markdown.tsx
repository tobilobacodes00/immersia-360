import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Info, Lightbulb, TriangleAlert } from 'lucide-react';
import { cx } from '@immersia/ui';
import { safeHref, type Block, type CalloutKind, type Inline } from '@/lib/help/markdown';

/**
 * Renders the parsed help Markdown (lib/help/markdown.ts) as React elements. There is no HTML string
 * anywhere on this path: every piece of article text reaches the page as a React child, which
 * escapes it, and a link is rendered only if `safeHref` accepts its address.
 */

export interface MarkdownLabels {
  note: string;
  tip: string;
  warning: string;
  /** Names the scrollable region around a code block or a table, for keyboard and screen reader users. */
  code: string;
  table: string;
  newTab: string;
}

export interface MarkdownContext {
  /** Address of another help article (`help:slug` links): differs between /help and /studio/help. */
  helpHref: (slug: string, anchor: string | null) => string;
  labels: MarkdownLabels;
}

const LINK =
  'focus-ring rounded-sm font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent';

function Inlines({ nodes, ctx }: { nodes: readonly Inline[]; ctx: MarkdownContext }): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return n.v;
      case 'code':
        return (
          <code key={i} className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[0.9em] break-words">
            {n.v}
          </code>
        );
      case 'strong':
        return (
          <strong key={i} className="font-semibold">
            <Inlines nodes={n.c} ctx={ctx} />
          </strong>
        );
      case 'em':
        return (
          <em key={i}>
            <Inlines nodes={n.c} ctx={ctx} />
          </em>
        );
      case 'link': {
        const link = safeHref(n.href);
        if (!link) return <Inlines key={i} nodes={n.c} ctx={ctx} />;
        const inner = <Inlines nodes={n.c} ctx={ctx} />;
        switch (link.kind) {
          case 'help':
            return (
              <Link key={i} href={ctx.helpHref(link.slug, link.anchor) as Route} className={LINK}>
                {inner}
              </Link>
            );
          case 'internal':
            return (
              <Link key={i} href={link.href as Route} className={LINK}>
                {inner}
              </Link>
            );
          case 'external':
            return (
              <a key={i} href={link.href} target="_blank" rel="noopener noreferrer" className={LINK}>
                {inner}
                <span className="sr-only"> ({ctx.labels.newTab})</span>
              </a>
            );
          case 'anchor':
          case 'mailto':
            return (
              <a key={i} href={link.href} className={LINK}>
                {inner}
              </a>
            );
        }
      }
    }
  });
}

const CALLOUT: Record<CalloutKind, { Icon: typeof Info; box: string; icon: string }> = {
  note: { Icon: Info, box: 'border-accent/25 bg-accent-soft', icon: 'text-accent' },
  tip: { Icon: Lightbulb, box: 'border-ok/25 bg-ok/[0.07]', icon: 'text-ok' },
  warning: { Icon: TriangleAlert, box: 'border-warn/30 bg-warn/[0.08]', icon: 'text-warn' },
};

const HEADING = {
  2: 'mt-10 scroll-mt-24 text-[22px] leading-tight font-bold tracking-[-0.02em]',
  3: 'mt-7 scroll-mt-24 text-[17px] leading-snug font-semibold tracking-[-0.01em]',
  4: 'mt-5 scroll-mt-24 text-[15px] font-semibold',
} as const;

function Blocks({ blocks, ctx, nested }: { blocks: readonly Block[]; ctx: MarkdownContext; nested?: boolean }) {
  return blocks.map((b, i) => {
    switch (b.t) {
      case 'heading': {
        const Tag = `h${b.level}` as 'h2' | 'h3' | 'h4';
        return (
          <Tag key={i} id={b.id} className={HEADING[b.level]}>
            <Inlines nodes={b.c} ctx={ctx} />
          </Tag>
        );
      }
      case 'p':
        return (
          <p key={i} className={cx('text-[15px] leading-[1.7]', nested ? 'mt-1.5' : 'mt-3')}>
            <Inlines nodes={b.c} ctx={ctx} />
          </p>
        );
      case 'list': {
        const Tag = b.ordered ? 'ol' : 'ul';
        return (
          <Tag
            key={i}
            className={cx(
              'space-y-1.5 pl-6 text-[15px] leading-[1.7] marker:text-faint',
              b.ordered ? 'list-decimal' : 'list-disc',
              nested ? 'mt-1.5' : 'mt-3',
            )}
          >
            {b.items.map((item, k) => (
              <li key={k} className="pl-1">
                <Blocks blocks={item} ctx={ctx} nested />
              </li>
            ))}
          </Tag>
        );
      }
      case 'quote': {
        if (!b.kind)
          return (
            <blockquote key={i} className="mt-4 border-l-2 border-line-strong pl-4 text-muted">
              <Blocks blocks={b.c} ctx={ctx} nested />
            </blockquote>
          );
        const { Icon, box, icon } = CALLOUT[b.kind];
        return (
          <aside key={i} className={cx('mt-4 flex gap-3 rounded-xl border p-4', box)}>
            <Icon className={cx('mt-0.5 size-4 shrink-0', icon)} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold">{ctx.labels[b.kind]}</p>
              <Blocks blocks={b.c} ctx={ctx} nested />
            </div>
          </aside>
        );
      }
      case 'code':
        return (
          // Scrollable, so reachable from the keyboard.
          <div
            key={i}
            role="region"
            aria-label={ctx.labels.code}
            tabIndex={0}
            className="focus-ring mt-4 overflow-x-auto rounded-xl bg-ink"
          >
            <pre className="p-4 text-[13px] leading-relaxed text-white">
              <code className="font-mono">{b.v}</code>
            </pre>
          </div>
        );
      case 'table':
        return (
          <div
            key={i}
            role="region"
            aria-label={ctx.labels.table}
            tabIndex={0}
            className="focus-ring mt-4 overflow-x-auto rounded-xl border border-line"
          >
            <table className="w-full min-w-[28rem] border-collapse text-left text-[14px]">
              <thead className="bg-sunken">
                <tr>
                  {b.head.map((cell, k) => (
                    <th key={k} scope="col" className="px-4 py-2.5 font-semibold">
                      <Inlines nodes={cell} ctx={ctx} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, k) => (
                      <td key={k} className="px-4 py-2.5 align-top leading-relaxed">
                        <Inlines nodes={cell} ctx={ctx} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'hr':
        return <hr key={i} className="my-8 border-line" />;
    }
  });
}

export function Markdown({ blocks, ctx }: { blocks: readonly Block[]; ctx: MarkdownContext }) {
  return (
    <div className="[&>*:first-child]:mt-0">
      <Blocks blocks={blocks} ctx={ctx} />
    </div>
  );
}
