import 'server-only';
import { after } from 'next/server';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@immersia/db';
import { uuidv7 } from '@immersia/shared';
import { audit } from './audit';
import { createPersonalOrganization } from './auth';
import { disconnect } from './cloud/integrations';
import { CLOUD_PROVIDERS } from './cloud/types';
import { LATE_UPLOAD_GRACE_MS } from './erasure-core';
import type { Operator } from './session';
import { deleteObjects, listKeys, organizationPrefix, storageConfigured } from './storage';

const {
  organization,
  member,
  event,
  captureSession,
  output,
  device,
  integration,
  asset,
  template,
  guestContact,
  auditLog,
  organizationDeletion,
  analyticsEvent,
} = schema;

/**
 * The operator's own data rights, at the level of the whole account: export everything we hold
 * about the organization (except media), and delete the organization.
 */

// -----------------------------------------------------------------------------------------------
// Export my data

export const EXPORT_FORMAT = 'immersia-360-export';
export const EXPORT_VERSION = 1;

/**
 * A JSON document with the organization, its members, events (with all settings), design templates,
 * library asset metadata, devices (never their tokens), cloud connections (never their tokens) and
 * every guest contact with its consent proof. Photos and videos are not included: they are the
 * operator's files to download from the event screens, and expire anyway.
 */
export async function exportOrganization(organizationId: string): Promise<Record<string, unknown> | null> {
  const [org] = await db().select().from(organization).where(eq(organization.id, organizationId)).limit(1);
  if (!org) return null;

  const [members, events, usage, templates, assets, devices, integrations, contacts, log] = await Promise.all([
    db()
      .select({ name: schema.user.name, email: schema.user.email, role: member.role, joinedAt: member.createdAt })
      .from(member)
      .innerJoin(schema.user, eq(schema.user.id, member.userId))
      .where(eq(member.organizationId, organizationId))
      .orderBy(asc(member.createdAt)),
    db().select().from(event).where(eq(event.organizationId, organizationId)).orderBy(asc(event.date), asc(event.id)),
    db()
      .select({
        eventId: captureSession.eventId,
        sessions: sql<number>`count(distinct ${captureSession.id})`.mapWith(Number),
        outputs: sql<number>`count(${output.id})`.mapWith(Number),
        bytes: sql<number>`coalesce(sum(${output.bytes}), 0)`.mapWith(Number),
      })
      .from(captureSession)
      .innerJoin(event, eq(event.id, captureSession.eventId))
      .leftJoin(output, eq(output.sessionId, captureSession.id))
      .where(eq(event.organizationId, organizationId))
      .groupBy(captureSession.eventId),
    db().select().from(template).where(eq(template.organizationId, organizationId)),
    db()
      .select()
      .from(asset)
      .where(and(eq(asset.organizationId, organizationId), isNull(asset.deletedAt))),
    db().select().from(device).where(eq(device.organizationId, organizationId)).orderBy(asc(device.createdAt)),
    db().select().from(integration).where(eq(integration.organizationId, organizationId)),
    db()
      .select({
        id: guestContact.id,
        eventId: guestContact.eventId,
        name: guestContact.name,
        email: guestContact.email,
        consentAt: guestContact.consentAt,
        consentText: guestContact.consentText,
        consentLocale: guestContact.consentLocale,
        policyUrl: guestContact.policyUrl,
        sessionCode: captureSession.shortCode,
        createdAt: guestContact.createdAt,
      })
      .from(guestContact)
      .innerJoin(event, eq(event.id, guestContact.eventId))
      .leftJoin(captureSession, eq(captureSession.id, guestContact.sessionId))
      .where(eq(event.organizationId, organizationId))
      .orderBy(asc(guestContact.createdAt)),
    db()
      .select()
      .from(auditLog)
      .where(eq(auditLog.organizationId, organizationId))
      .orderBy(desc(auditLog.createdAt))
      .limit(1000),
  ]);
  const usageByEvent = new Map(usage.map((u) => [u.eventId, u]));

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    note: 'Photos and videos are not included. Secrets (device tokens, cloud tokens, gallery passwords, kiosk PINs) are never exported.',
    organization: { id: org.id, name: org.name, slug: org.slug, createdAt: org.createdAt },
    members,
    events: events.map((e) => ({
      id: e.id,
      name: e.name,
      date: e.date,
      mode: e.mode,
      status: e.status,
      expiryDays: e.expiryDays,
      filenamePrefixEnabled: e.filenamePrefixEnabled,
      liveDisplayEnabled: e.liveDisplayEnabled,
      moderation: e.moderation,
      gallerySlug: e.gallerySlug,
      galleryPasswordSet: e.galleryPasswordHash !== null,
      kioskPinSet: e.kioskPinHash !== null,
      outputSettings: e.outputSettings,
      shareSettings: e.shareSettings,
      branding: e.branding,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      archivedAt: e.archivedAt,
      sessions: usageByEvent.get(e.id)?.sessions ?? 0,
      outputs: usageByEvent.get(e.id)?.outputs ?? 0,
      storageBytes: usageByEvent.get(e.id)?.bytes ?? 0,
    })),
    templates: templates.map((t) => ({
      id: t.id,
      eventId: t.eventId,
      kind: t.kind,
      name: t.name,
      category: t.category,
      tags: t.tags,
      canvas: t.canvas,
      elements: t.elements,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
    assets: assets.map((a) => ({
      id: a.id,
      type: a.type,
      name: a.name,
      mime: a.mime,
      bytes: a.bytes,
      width: a.width,
      height: a.height,
      durationMs: a.durationMs,
      createdAt: a.createdAt,
    })),
    devices: devices.map((d) => ({
      id: d.id,
      name: d.name,
      platform: d.platform,
      browser: d.browser,
      capabilities: d.capabilities,
      lastSeenAt: d.lastSeenAt,
      createdAt: d.createdAt,
      revokedAt: d.revokedAt,
    })),
    integrations: integrations.map((i) => ({
      provider: i.provider,
      status: i.status,
      accountEmail: i.accountEmail,
      folderName: i.folderName,
      createdAt: i.createdAt,
    })),
    guestContacts: contacts,
    auditLog: log.map((l) => ({ at: l.createdAt, action: l.action, target: l.target, meta: l.meta })),
  };
}

// -----------------------------------------------------------------------------------------------
// Delete organization

/**
 * Delete the organization, for good. In one transaction: the organization row goes, and with it (by
 * cascade) its events, sessions, outputs, guest contacts, devices, displays, templates, assets,
 * integrations (the encrypted tokens), members and invitations; members' sessions stop pointing at
 * it; and the leftovers that can't be deleted in a transaction are queued (organization_deletion).
 * Cloud grants are revoked at Google/Dropbox first, best effort.
 *
 * Files in storage are swept in batches by the hourly cron until the organization's prefix is empty
 * (runOrganizationDeletions), started at once in the background. Every step can be repeated.
 */
export async function deleteOrganization(op: Operator): Promise<void> {
  const organizationId = op.organizationId;
  await Promise.all(CLOUD_PROVIDERS.map((p) => disconnect(organizationId, p).catch(() => false)));

  const members = await db()
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, organizationId));
  const [counts] = await db()
    .select({ events: sql<number>`count(*)`.mapWith(Number) })
    .from(event)
    .where(eq(event.organizationId, organizationId));

  await db().transaction(async (tx) => {
    await tx.insert(organizationDeletion).values({
      id: uuidv7(),
      organizationId,
      storagePrefix: organizationPrefix(organizationId),
    });
    // The organization's own audit entries go with it; this one outlives it (no organization to point at).
    await audit(
      {
        organizationId: null,
        actorUserId: op.userId,
        action: 'organization.deleted',
        target: organizationId,
        meta: { name: op.organizationName, members: members.length, events: counts?.events ?? 0 },
      },
      tx,
    );
    // Sign every member out of it: their sessions no longer point at an organization that is gone.
    await tx
      .update(schema.session)
      .set({ activeOrganizationId: null })
      .where(eq(schema.session.activeOrganizationId, organizationId));
    await tx.delete(organization).where(eq(organization.id, organizationId));
  });

  // Anyone left without an organization (the owner who just deleted their only one) gets a fresh
  // empty one, so signing back in doesn't loop between the studio and the sign-in page.
  const userIds = members.map((m) => m.userId);
  if (userIds.length) {
    const stillIn = new Set(
      (await db().select({ userId: member.userId }).from(member).where(inArray(member.userId, userIds))).map(
        (m) => m.userId,
      ),
    );
    const orphaned = userIds.filter((id) => !stillIn.has(id));
    if (orphaned.length) {
      const users = await db()
        .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
        .from(schema.user)
        .where(inArray(schema.user.id, orphaned));
      for (const u of users) await createPersonalOrganization(u);
    }
  }

  after(() =>
    runOrganizationDeletions().then(undefined, (err: unknown) => console.error('[deletion] sweep failed', err)),
  );
}

/**
 * The sweep for deleted organizations (hourly cron, and once straight after a deletion). Removes
 * their analytics rows, then empties their storage prefix in batches of 1000 until the time budget
 * runs out; the next run carries on. A job completes only once the prefix is empty AND two hours
 * have passed since the request, so a file a booth uploads with a signed URL issued before the
 * deletion is swept too.
 */
export async function runOrganizationDeletions(
  budgetMs = 120_000,
  limit = 5,
): Promise<{ jobs: number; objects: number; completed: number }> {
  const deadline = Date.now() + budgetMs;
  const jobs = await db()
    .select()
    .from(organizationDeletion)
    .where(isNull(organizationDeletion.completedAt))
    .orderBy(asc(organizationDeletion.requestedAt))
    .limit(limit);
  let objects = 0;
  let completed = 0;
  for (const job of jobs) {
    try {
      if (!job.analyticsPurgedAt) {
        await db().delete(analyticsEvent).where(eq(analyticsEvent.organizationId, job.organizationId));
        await db()
          .update(organizationDeletion)
          .set({ analyticsPurgedAt: new Date() })
          .where(eq(organizationDeletion.id, job.id));
      }
      let drained = !storageConfigured();
      let removed = 0;
      while (!drained && Date.now() < deadline) {
        const keys = await listKeys(job.storagePrefix);
        if (keys.length === 0) {
          drained = true;
          break;
        }
        removed += await deleteObjects(keys);
      }
      objects += removed;
      const settled = drained && Date.now() - job.requestedAt.getTime() >= LATE_UPLOAD_GRACE_MS;
      if (settled) completed++;
      await db()
        .update(organizationDeletion)
        .set({
          objectsDeleted: sql`${organizationDeletion.objectsDeleted} + ${removed}`,
          attempts: sql`${organizationDeletion.attempts} + 1`,
          lastError: null,
          completedAt: settled ? new Date() : null,
        })
        .where(eq(organizationDeletion.id, job.id));
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      console.error('[deletion] could not finish a job', job.id, message);
      await db()
        .update(organizationDeletion)
        .set({ attempts: sql`${organizationDeletion.attempts} + 1`, lastError: message })
        .where(eq(organizationDeletion.id, job.id));
    }
  }
  return { jobs: jobs.length, objects, completed };
}
