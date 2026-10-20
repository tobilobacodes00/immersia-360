import { describe, expect, it } from 'vitest';
import { CHECK_TIMEOUT_MS, DEGRADED_MS, gradeCheck, overallState, type ServiceCheck } from './services';
import { incidentsSchema, loadIncidents, recentIncidents, type Incident } from './incidents';

const svc = (id: ServiceCheck['id'], state: ServiceCheck['state']): ServiceCheck => ({ id, state, ms: 10 });

describe('status: grading a check', () => {
  it('is operational when it answers promptly, degraded when slow, down when it fails', () => {
    expect(gradeCheck({ ok: true, ms: 40 })).toBe('operational');
    expect(gradeCheck({ ok: true, ms: DEGRADED_MS })).toBe('operational');
    expect(gradeCheck({ ok: true, ms: DEGRADED_MS + 1 })).toBe('degraded');
    expect(gradeCheck({ ok: false, ms: 5 })).toBe('down');
  });
  it('gives up on a check before the page would feel broken', () => {
    expect(CHECK_TIMEOUT_MS).toBeGreaterThan(DEGRADED_MS);
    expect(CHECK_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });
});

describe('status: overall state', () => {
  const ok = [
    svc('database', 'operational'),
    svc('storage', 'operational'),
    svc('realtime', 'not_configured'),
    svc('email', 'operational'),
  ];
  const with_ = (id: ServiceCheck['id'], state: ServiceCheck['state']) =>
    ok.map((s) => (s.id === id ? svc(id, state) : s));

  it('is operational when everything that is in use works; unused services do not count', () => {
    expect(overallState(ok)).toBe('operational');
    expect(overallState([svc('database', 'operational'), svc('realtime', 'not_configured')])).toBe('operational');
    expect(overallState([])).toBe('operational');
  });

  it('is an outage when the database, file storage or email is down', () => {
    expect(overallState(with_('database', 'down'))).toBe('outage');
    expect(overallState(with_('storage', 'down'))).toBe('outage');
    expect(overallState(with_('email', 'down'))).toBe('outage');
  });

  it('is only degraded when the optional Live Display hub is down (screens fall back to polling)', () => {
    expect(overallState(with_('realtime', 'down'))).toBe('degraded');
  });

  it('is degraded when a core service is merely slow', () => {
    expect(overallState(with_('database', 'degraded'))).toBe('degraded');
  });
});

const incident = (over: Partial<Incident> = {}): Incident => ({
  id: 'storage-slow',
  startedAt: '2026-10-10T09:00:00Z',
  resolvedAt: '2026-10-10T11:30:00Z',
  impact: 'minor',
  services: ['storage'],
  title: { en: 'Downloads were slow', es: 'Descargas lentas', pt: 'Downloads lentos' },
  body: { en: 'Storage was slow for a while.', es: 'El almacenamiento fue lento.', pt: 'O armazenamento ficou lento.' },
  ...over,
});

describe('status: incidents', () => {
  it('accepts a complete entry and an empty list', () => {
    expect(incidentsSchema.safeParse([incident()]).success).toBe(true);
    expect(incidentsSchema.safeParse([]).success).toBe(true);
  });

  it('needs the text in every language, a known service and a sane timeline', () => {
    expect(incidentsSchema.safeParse([incident({ title: { en: 'Only English' } as Incident['title'] })]).success).toBe(
      false,
    );
    expect(incidentsSchema.safeParse([{ ...incident(), services: ['mainframe'] }]).success).toBe(false);
    expect(incidentsSchema.safeParse([incident({ resolvedAt: '2026-10-10T08:00:00Z' })]).success).toBe(false);
    expect(incidentsSchema.safeParse([{ ...incident(), startedAt: 'yesterday' }]).success).toBe(false);
    expect(incidentsSchema.safeParse([incident(), incident()]).success).toBe(false);
  });

  it('lists ongoing incidents first, then recent ones, newest first, and drops old ones', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    const ongoing = incident({ id: 'ongoing', startedAt: '2026-01-01T00:00:00Z', resolvedAt: null });
    const recent = incident({ id: 'recent' });
    const older = incident({ id: 'older', startedAt: '2026-09-01T00:00:00Z', resolvedAt: '2026-09-01T02:00:00Z' });
    const ancient = incident({ id: 'ancient', startedAt: '2026-03-01T00:00:00Z', resolvedAt: '2026-03-01T02:00:00Z' });
    expect(recentIncidents([ancient, older, recent, ongoing], now).map((i) => i.id)).toEqual([
      'ongoing',
      'recent',
      'older',
    ]);
  });

  it('the incidents file in the repository is valid', async () => {
    await expect(loadIncidents()).resolves.toBeInstanceOf(Array);
  });
});
