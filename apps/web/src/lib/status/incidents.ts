import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { LOCALES, type Locale } from '@immersia/i18n';
import { SERVICE_IDS } from './services';

/**
 * Past and current incidents for the status page (HLP-4), kept in `content/status/incidents.json`:
 * a person writes an entry when something happens and deploys it, so the page never depends on the
 * thing that is broken. Each entry carries its text in every language.
 */

const localized = z.object(
  Object.fromEntries(LOCALES.map((l) => [l, z.string().trim().min(3).max(600)])) as Record<Locale, z.ZodString>,
);

export const incidentSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    startedAt: z.iso.datetime(),
    /** null while it is still going on. */
    resolvedAt: z.iso.datetime().nullable(),
    impact: z.enum(['minor', 'major', 'maintenance']),
    services: z.array(z.enum(SERVICE_IDS)).max(SERVICE_IDS.length),
    title: localized,
    body: localized,
  })
  .strict()
  .refine((i) => i.resolvedAt === null || Date.parse(i.resolvedAt) >= Date.parse(i.startedAt), {
    message: 'an incident cannot be resolved before it started',
    path: ['resolvedAt'],
  });

export type Incident = z.infer<typeof incidentSchema>;

export const incidentsSchema = z.array(incidentSchema).superRefine((list, ctx) => {
  const seen = new Set<string>();
  list.forEach((i, n) => {
    if (seen.has(i.id)) ctx.addIssue({ code: 'custom', path: [n, 'id'], message: `duplicate incident id ${i.id}` });
    seen.add(i.id);
  });
});

/** How far back the page looks. */
export const INCIDENT_WINDOW_DAYS = 90;

/** Ongoing incidents, then those that started or ended within the window, newest first. */
export function recentIncidents(list: readonly Incident[], now: Date, days = INCIDENT_WINDOW_DAYS): Incident[] {
  const since = now.getTime() - days * 86_400_000;
  return list
    .filter((i) => i.resolvedAt === null || Date.parse(i.resolvedAt) >= since)
    .sort(
      (a, b) =>
        Number(b.resolvedAt === null) - Number(a.resolvedAt === null) ||
        Date.parse(b.startedAt) - Date.parse(a.startedAt),
    );
}

export function incidentsFile(): string {
  if (process.env.STATUS_CONTENT_DIR) return path.join(process.env.STATUS_CONTENT_DIR, 'incidents.json');
  const candidates = [
    path.join(process.cwd(), 'content', 'status', 'incidents.json'),
    path.join(process.cwd(), 'apps', 'web', 'content', 'status', 'incidents.json'),
  ];
  return candidates.find((c) => existsSync(c)) ?? candidates[0]!;
}

/** Reads and validates the file. Throws on a malformed file (the tests catch that before deploy). */
export async function loadIncidents(file = incidentsFile()): Promise<Incident[]> {
  return incidentsSchema.parse(JSON.parse(await readFile(file, 'utf8')));
}
