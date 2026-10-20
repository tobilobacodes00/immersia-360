/**
 * Immersia 360 domain model (PRD "Core data model", plus the entities it implies).
 *
 * Conventions
 * - Primary keys are UUIDv7 minted by the app (often on the booth device, offline), never by the DB.
 * - Every row that belongs to an operator business carries `organization_id`, directly or via its
 *   event, so tenancy checks are one join at most.
 * - Timestamps are timestamptz. Device-reported times (captured_at) are kept separately from
 *   server receipt times (received_at), because booth clocks drift.
 * - The guest "Session" from the PRD is `capture_session` here: `session` is Better Auth's table.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organization, user } from './auth';
import type {
  BrandingSettings,
  DeviceCapabilities,
  DeviceStatus,
  DisplaySettings,
  OutputSettings,
  ShareSettings,
  TemplateCanvas,
  TemplateElement,
  RenderRecipe,
} from './types';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const orgId = () =>
  text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' });

// ---------------------------------------------------------------------------------------------
// Enums

export const boothMode = pgEnum('booth_mode', ['video360', 'photo']);
export const eventStatus = pgEnum('event_status', ['draft', 'live', 'archived']);
export const moderationMode = pgEnum('moderation_mode', ['auto', 'approve']);
export const assetType = pgEnum('asset_type', [
  'overlay',
  'layout',
  'intro',
  'outro',
  'audio',
  'font',
  'logo',
  'background',
]);
/** An upload is `pending` until its object is verified (size and magic bytes); only `ready` assets are usable. */
export const assetStatus = pgEnum('asset_status', ['pending', 'ready']);
export const templateKind = pgEnum('template_kind', ['layout', 'overlay']);
export const takeStatus = pgEnum('take_status', ['local', 'uploading', 'uploaded', 'failed']);
export const captureTrigger = pgEnum('capture_trigger', ['tap', 'timer', 'motion', 'remote', 'keyboard', 'import']);
export const sessionStatus = pgEnum('session_status', ['pending', 'live', 'expired']);
export const outputKind = pgEnum('output_kind', [
  'mp4',
  'small_mp4',
  'gif',
  'strip',
  'short_video',
  'boomerang',
  'poster',
]);
export const displayStatus = pgEnum('display_status', ['pending', 'shown', 'hidden', 'opted_out']);
export const displayLayout = pgEnum('display_layout', ['spotlight', 'mosaic', 'ticker', 'counter']);
export const integrationProvider = pgEnum('integration_provider', ['drive', 'dropbox']);
export const integrationStatus = pgEnum('integration_status', ['connected', 'needs_reauth', 'revoked']);
export const uploadTarget = pgEnum('upload_target', ['hosted', 'drive', 'dropbox']);
export const uploadStatus = pgEnum('upload_status', ['pending', 'uploading', 'done', 'failed']);
export const reportReason = pgEnum('report_reason', ['not_me', 'inappropriate', 'illegal', 'privacy', 'other']);
/** `escalated` is passed up for a decision: unresolved, so it keeps the 24-hour clock. */
export const reportStatus = pgEnum('report_status', ['open', 'actioned', 'dismissed', 'escalated']);
/** Why a session is no longer served: hidden by its operator, or taken down by the platform (policy, or illegal → 451). */
export const removalBasis = pgEnum('removal_basis', ['operator', 'policy', 'legal']);
export const renderJobStatus = pgEnum('render_job_status', ['queued', 'running', 'done', 'failed']);

// ---------------------------------------------------------------------------------------------
// Devices (ACC-2): unlimited per account, named, revocable

export const device = pgTable(
  'device',
  {
    id: uuid('id').primaryKey(),
    organizationId: orgId(),
    name: text('name').notNull(),
    platform: text('platform').notNull(),
    browser: text('browser').notNull(),
    capabilities: jsonb('capabilities').$type<DeviceCapabilities>().notNull(),
    /** SHA-256 of the device token; the token itself only ever lives on the device. */
    tokenHash: text('token_hash').notNull(),
    registeredBy: text('registered_by').references(() => user.id, { onDelete: 'set null' }),
    lastSeenAt: ts('last_seen_at'),
    /** Latest heartbeat: which event it runs, render/upload queue depth (feeds EVT-3). */
    status: jsonb('status').$type<DeviceStatus>(),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [index('device_org_idx').on(t.organizationId), uniqueIndex('device_token_idx').on(t.tokenHash)],
);

// ---------------------------------------------------------------------------------------------
// Events (EVT-1..5)

export const event = pgTable(
  'event',
  {
    id: uuid('id').primaryKey(),
    organizationId: orgId(),
    name: text('name').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    mode: boothMode('mode').notNull(),
    status: eventStatus('status').notNull().default('draft'),
    outputSettings: jsonb('output_settings').$type<OutputSettings>().notNull(),
    shareSettings: jsonb('share_settings').$type<ShareSettings>().notNull(),
    branding: jsonb('branding').$type<BrandingSettings>().notNull(),
    expiryDays: smallint('expiry_days').notNull().default(30),
    filenamePrefixEnabled: boolean('filename_prefix_enabled').notNull().default(false),
    /** Next number for the EVT-5 prefix; incremented atomically when a session is registered. */
    filenameSequence: integer('filename_sequence').notNull().default(1),
    liveDisplayEnabled: boolean('live_display_enabled').notNull().default(false),
    moderation: moderationMode('moderation').notNull().default('auto'),
    kioskPinHash: text('kiosk_pin_hash'),
    /** Public, unguessable slug for the event gallery (/g/[slug]). */
    gallerySlug: text('gallery_slug').notNull(),
    galleryPasswordHash: text('gallery_password_hash'),
    duplicatedFromId: uuid('duplicated_from_id'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: ts('archived_at'),
  },
  (t) => [
    index('event_org_date_idx').on(t.organizationId, t.date),
    uniqueIndex('event_gallery_slug_idx').on(t.gallerySlug),
    check('event_expiry_days_check', sql`${t.expiryDays} in (7, 30, 90)`),
  ],
);

// ---------------------------------------------------------------------------------------------
// Assets and templates (PHO-4..6, PHO-9, VID-4..6)

export const asset = pgTable(
  'asset',
  {
    id: uuid('id').primaryKey(),
    organizationId: orgId(),
    type: assetType('type').notNull(),
    status: assetStatus('status').notNull().default('pending'),
    name: text('name').notNull(),
    objectKey: text('object_key').notNull(),
    mime: text('mime').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('asset_org_type_idx').on(t.organizationId, t.type)],
);

export const template = pgTable(
  'template',
  {
    id: uuid('id').primaryKey(),
    /** Null = the built-in library (PHO-5), shared by everyone. */
    organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => event.id, { onDelete: 'cascade' }),
    kind: templateKind('kind').notNull(),
    name: text('name').notNull(),
    category: text('category'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    canvas: jsonb('canvas').$type<TemplateCanvas>().notNull(),
    elements: jsonb('elements').$type<TemplateElement[]>().notNull(),
    schemaVersion: smallint('schema_version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('template_org_idx').on(t.organizationId),
    index('template_event_idx').on(t.eventId),
    index('template_library_idx')
      .on(t.kind, t.category)
      .where(sql`${t.organizationId} is null`),
  ],
);

// ---------------------------------------------------------------------------------------------
// Capture: takes, guest sessions and outputs (DL-1)

export const take = pgTable(
  'take',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => device.id, { onDelete: 'set null' }),
    rawObjectKey: text('raw_object_key'),
    capturedAt: ts('captured_at').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    durationMs: integer('duration_ms').notNull(),
    fps: smallint('fps').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    trigger: captureTrigger('trigger').notNull(),
    status: takeStatus('status').notNull().default('local'),
  },
  (t) => [index('take_event_idx').on(t.eventId, t.capturedAt)],
);

export const captureSession = pgTable(
  'capture_session',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => device.id, { onDelete: 'set null' }),
    /** 128-bit base64url link id (DL-14), minted on the device. */
    linkId: text('link_id').notNull(),
    shortCode: text('short_code').notNull(),
    filenamePrefix: text('filename_prefix').notNull().default(''),
    status: sessionStatus('status').notNull().default('pending'),
    /** Guest chose "don't show on screen" (LIV-8): never published to displays. */
    optedOutOfDisplay: boolean('opted_out_of_display').notNull().default(false),
    /**
     * The session as one Live Display item (LIV-7): pending (not ready, or awaiting approval),
     * shown, hidden by the operator, or opted_out (the guest declined, or the display was off when
     * they captured it, so they were never told it might appear).
     */
    displayStatus: displayStatus('display_status').notNull().default('pending'),
    /** When it went on screen: approve-first items are timed at approval, so they appear as new. */
    displayedAt: ts('displayed_at'),
    capturedAt: ts('captured_at').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    expiredAt: ts('expired_at'),
    /**
     * Taken down or hidden (reports): the share page answers 451/410, and the gallery, Live Display
     * and Sharing Station stop serving it at once. `removal` says by whom and why; only the
     * operator's own `operator` hide can be undone by the operator.
     */
    removedAt: ts('removed_at'),
    removal: removalBasis('removal'),
    removedBy: text('removed_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('capture_session_link_idx').on(t.linkId),
    uniqueIndex('capture_session_code_idx').on(t.shortCode),
    index('capture_session_event_idx').on(t.eventId, t.capturedAt),
    index('capture_session_display_idx').on(t.eventId, t.displayStatus, t.displayedAt),
    index('capture_session_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${t.expiredAt} is null`),
  ],
);

export const output = pgTable(
  'output',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => captureSession.id, { onDelete: 'cascade' }),
    takeId: uuid('take_id').references(() => take.id, { onDelete: 'set null' }),
    kind: outputKind('kind').notNull(),
    objectKey: text('object_key'),
    mime: text('mime').notNull(),
    bytes: bigint('bytes', { mode: 'number' }),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    displayStatus: displayStatus('display_status').notNull().default('pending'),
    downloads: integer('downloads').notNull().default(0),
    uploadedAt: ts('uploaded_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('output_session_idx').on(t.sessionId),
    // One output of each kind per take (or per session when take_id is null, e.g. a strip).
    unique('output_session_kind_take_uq').on(t.sessionId, t.kind, t.takeId).nullsNotDistinct(),
  ],
);

/**
 * Short codes reserved by a device while online, consumed offline (DL-2). The code is the primary
 * key, so reservation is a plain insert that fails on collision; capture_session.short_code is
 * also unique, which makes double-use impossible.
 */
export const shortCodeReservation = pgTable(
  'short_code_reservation',
  {
    code: text('code').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'cascade' }),
    reservedAt: ts('reserved_at').notNull().defaultNow(),
    usedAt: ts('used_at'),
  },
  (t) => [
    index('short_code_device_free_idx')
      .on(t.deviceId, t.eventId)
      .where(sql`${t.usedAt} is null`),
  ],
);

// ---------------------------------------------------------------------------------------------
// Live Display (LIV-1..13)

export const display = pgTable(
  'display',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    layout: displayLayout('layout').notNull().default('spotlight'),
    settings: jsonb('settings').$type<DisplaySettings>().notNull(),
    tokenHash: text('token_hash').notNull(),
    pairedAt: ts('paired_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('display_event_idx').on(t.eventId), uniqueIndex('display_token_idx').on(t.tokenHash)],
);

export const displayPairing = pgTable(
  'display_pairing',
  {
    code: text('code').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    expiresAt: ts('expires_at').notNull(),
    claimedAt: ts('claimed_at'),
    displayId: uuid('display_id').references(() => display.id, { onDelete: 'set null' }),
  },
  (t) => [index('display_pairing_event_idx').on(t.eventId)],
);

// ---------------------------------------------------------------------------------------------
// Bring-your-own cloud (SHR-7) and uploads

export const integration = pgTable(
  'integration',
  {
    id: uuid('id').primaryKey(),
    organizationId: orgId(),
    provider: integrationProvider('provider').notNull(),
    /** AES-256-GCM ciphertext of the refresh token (key from env, never in the DB). */
    encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
    accountEmail: text('account_email'),
    folderId: text('folder_id'),
    folderName: text('folder_name'),
    status: integrationStatus('status').notNull().default('connected'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('integration_org_provider_idx').on(t.organizationId, t.provider)],
);

export const uploadObject = pgTable(
  'upload_object',
  {
    id: uuid('id').primaryKey(),
    outputId: uuid('output_id')
      .notNull()
      .references(() => output.id, { onDelete: 'cascade' }),
    target: uploadTarget('target').notNull(),
    /** outputId:target — retries and reconnects can never create a duplicate (acceptance #6). */
    idempotencyKey: text('idempotency_key').notNull(),
    remoteId: text('remote_id'),
    remoteUrl: text('remote_url'),
    status: uploadStatus('status').notNull().default('pending'),
    attempts: smallint('attempts').notNull().default(0),
    /** A stable code (see apps/web/src/server/cloud/copy-core.ts), never provider text or tokens. */
    lastError: text('last_error'),
    /**
     * Cloud copies: while `pending`, the earliest time to try again (exponential backoff, or the
     * provider's Retry-After); while `uploading`, when the claim's lease runs out, so a worker that
     * died mid-upload does not park the row forever.
     */
    nextAttemptAt: ts('next_attempt_at'),
    createdAt: createdAt(),
    completedAt: ts('completed_at'),
  },
  (t) => [
    uniqueIndex('upload_object_idem_idx').on(t.idempotencyKey),
    index('upload_object_output_idx').on(t.outputId),
    index('upload_object_queue_idx')
      .on(t.status, t.nextAttemptAt)
      .where(sql`${t.status} in ('pending', 'uploading')`),
  ],
);

// ---------------------------------------------------------------------------------------------
// Guests: contact form (SHR-6), reports (Abuse)

export const guestContact = pgTable(
  'guest_contact',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => captureSession.id, { onDelete: 'set null' }),
    name: text('name'),
    email: text('email').notNull(),
    consentAt: ts('consent_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('guest_contact_event_idx').on(t.eventId)],
);

export const report = pgTable(
  'report',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => captureSession.id, { onDelete: 'cascade' }),
    outputId: uuid('output_id').references(() => output.id, { onDelete: 'set null' }),
    reason: reportReason('reason').notNull(),
    details: text('details'),
    /** Salted hash, rotated daily: enough to rate-limit, never enough to identify. */
    reporterHash: text('reporter_hash'),
    /** Only to reply to the reporter; cleared when the report is decided. */
    contactEmail: text('contact_email'),
    status: reportStatus('status').notNull().default('open'),
    /** The admin's note on the decision (why it was dismissed, what it was escalated for). */
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
    actionedAt: ts('actioned_at'),
    actionedBy: text('actioned_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('report_status_idx').on(t.status, t.createdAt),
    index('report_session_idx').on(t.sessionId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------------------------
// Server render fallback, analytics, audit

export const serverRenderJob = pgTable(
  'server_render_job',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => event.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => captureSession.id, { onDelete: 'cascade' }),
    takeId: uuid('take_id')
      .notNull()
      .references(() => take.id, { onDelete: 'cascade' }),
    recipe: jsonb('recipe').$type<RenderRecipe>().notNull(),
    status: renderJobStatus('status').notNull().default('queued'),
    attempts: smallint('attempts').notNull().default(0),
    error: text('error'),
    createdAt: createdAt(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('server_render_job_status_idx').on(t.status, t.createdAt)],
);

/**
 * First-party analytics. Partitioned by month on `occurred_at` in SQL (the `analytics_partitions`
 * migration; Drizzle does not model partitions, so this definition is the logical table). A default
 * partition catches anything outside the months that exist, so an insert never fails; the hourly
 * cron calls `analytics_ensure_partitions` to keep the months ahead created.
 */
export const analyticsEvent = pgTable(
  'analytics_event',
  {
    id: bigserial('id', { mode: 'number' }).notNull(),
    name: text('name').notNull(),
    props: jsonb('props').$type<Record<string, unknown>>().notNull(),
    organizationId: text('organization_id'),
    eventId: uuid('event_id'),
    deviceId: uuid('device_id'),
    /** The id the device minted for the event: a batch retried after a lost response is not counted twice. */
    clientId: uuid('client_id'),
    /** Who recorded it: our own code (`server`) or a booth, display or studio over POST /api/t. */
    source: text('source').notNull().default('server'),
    occurredAt: ts('occurred_at').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [
    index('analytics_event_name_time_idx').on(t.name, t.occurredAt),
    index('analytics_event_client_idx')
      .on(t.clientId)
      .where(sql`${t.clientId} is not null`),
  ],
);

/** The month's cloud bill, entered by a platform admin (no billing integration): cost per active operator. */
export const platformCost = pgTable(
  'platform_cost',
  {
    /** First day of the billing month. */
    month: date('month', { mode: 'string' }).primaryKey(),
    amountCents: integer('amount_cents').notNull(),
    note: text('note'),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [check('platform_cost_amount_check', sql`${t.amountCents} >= 0`)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target: text('target'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_log_org_time_idx').on(t.organizationId, t.createdAt),
    index('audit_log_action_time_idx').on(t.action, t.createdAt),
  ],
);
