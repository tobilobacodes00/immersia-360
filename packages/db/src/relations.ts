import { defineRelations } from 'drizzle-orm';
import * as schema from './schema';

/** Drizzle v1 relational config (Relations v2) for `db.query.*`. */
export const relations = defineRelations(schema, (r) => ({
  user: {
    memberships: r.many.member({ from: r.user.id, to: r.member.userId }),
  },
  organization: {
    members: r.many.member({ from: r.organization.id, to: r.member.organizationId }),
    devices: r.many.device({ from: r.organization.id, to: r.device.organizationId }),
    events: r.many.event({ from: r.organization.id, to: r.event.organizationId }),
    assets: r.many.asset({ from: r.organization.id, to: r.asset.organizationId }),
    integrations: r.many.integration({ from: r.organization.id, to: r.integration.organizationId }),
  },
  member: {
    user: r.one.user({ from: r.member.userId, to: r.user.id, optional: false }),
    organization: r.one.organization({ from: r.member.organizationId, to: r.organization.id, optional: false }),
  },
  device: {
    organization: r.one.organization({ from: r.device.organizationId, to: r.organization.id, optional: false }),
  },
  event: {
    organization: r.one.organization({ from: r.event.organizationId, to: r.organization.id, optional: false }),
    sessions: r.many.captureSession({ from: r.event.id, to: r.captureSession.eventId }),
    takes: r.many.take({ from: r.event.id, to: r.take.eventId }),
    templates: r.many.template({ from: r.event.id, to: r.template.eventId }),
    displays: r.many.display({ from: r.event.id, to: r.display.eventId }),
  },
  captureSession: {
    event: r.one.event({ from: r.captureSession.eventId, to: r.event.id, optional: false }),
    outputs: r.many.output({ from: r.captureSession.id, to: r.output.sessionId }),
  },
  output: {
    session: r.one.captureSession({ from: r.output.sessionId, to: r.captureSession.id, optional: false }),
    take: r.one.take({ from: r.output.takeId, to: r.take.id }),
    uploads: r.many.uploadObject({ from: r.output.id, to: r.uploadObject.outputId }),
  },
  take: {
    event: r.one.event({ from: r.take.eventId, to: r.event.id, optional: false }),
    device: r.one.device({ from: r.take.deviceId, to: r.device.id }),
  },
  display: {
    event: r.one.event({ from: r.display.eventId, to: r.event.id, optional: false }),
  },
}));
