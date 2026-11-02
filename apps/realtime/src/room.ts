/**
 * One Durable Object per event. It owns the event's message log (SQLite) and every socket connected
 * to the event. Sockets use the hibernation API, so an idle room with connected screens costs
 * nothing and the object is rebuilt, not kept alive, when a message arrives: everything it needs
 * lives in SQLite or in the socket's tags and attachment.
 *
 * Only the Worker in `worker.ts` talks to this class, after it has checked signatures and tokens.
 */
import { DurableObject } from 'cloudflare:workers';
import { livePublishSchema, type LiveRole } from '@immersia/shared/live';
import { parseSince, receives, RoomLog, type LogStorage, type StoredMessage, type Subscriber } from './core';

class SqlLogStorage implements LogStorage {
  private readonly sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.sql = sql;
    sql.exec('CREATE TABLE IF NOT EXISTS log (seq INTEGER PRIMARY KEY, body TEXT NOT NULL, at INTEGER NOT NULL)');
  }

  append(seq: number, message: StoredMessage): void {
    this.sql.exec('INSERT INTO log (seq, body, at) VALUES (?, ?, ?)', seq, JSON.stringify(message), Date.now());
  }

  since(seq: number): StoredMessage[] {
    return this.sql
      .exec<{ body: string }>('SELECT body FROM log WHERE seq > ? ORDER BY seq', seq)
      .toArray()
      .map((row) => JSON.parse(row.body) as StoredMessage);
  }

  oldest(): number | null {
    return this.sql.exec<{ seq: number | null }>('SELECT MIN(seq) AS seq FROM log').one().seq;
  }

  head(): number {
    return this.sql.exec<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM log').one().seq ?? 0;
  }

  prune(keepLast: number): void {
    this.sql.exec('DELETE FROM log WHERE seq <= (SELECT MAX(seq) FROM log) - ?', keepLast);
  }
}

function isRole(value: unknown): value is LiveRole {
  return value === 'display' || value === 'station' || value === 'operator';
}

/** Who a socket belongs to, read back from its attachment (which survives hibernation). */
function subscriberOf(ws: WebSocket): Subscriber | null {
  const attachment: unknown = ws.deserializeAttachment();
  if (typeof attachment !== 'object' || attachment === null) return null;
  const { role, sub } = attachment as Record<string, unknown>;
  return isRole(role) && typeof sub === 'string' ? { role, sub } : null;
}

function closeQuietly(ws: WebSocket, code: number): void {
  try {
    // A client's close code can be one that can't be sent back (1005, 1006): answer with a plain close.
    ws.close(code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000, 'closed');
  } catch {
    // Already closed: the handshake completed on its own.
  }
}

export class EventRoom extends DurableObject {
  private readonly log: RoomLog;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.log = new RoomLog(new SqlLogStorage(ctx.storage.sql));
    // Keep-alives are answered by the runtime without waking a hibernating object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  override async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/publish' && request.method === 'POST') return this.publish(request);
    if (pathname === '/socket' && request.method === 'GET') return this.acceptScreen(request);
    return new Response('not found', { status: 404 });
  }

  /** Appends a publish to the log and sends it on to every socket that may see it. */
  private async publish(request: Request): Promise<Response> {
    const parsed = livePublishSchema.safeParse(await request.json<unknown>().catch(() => null));
    if (!parsed.success) return new Response('invalid publish', { status: 400 });
    const message = this.log.publish(parsed.data);
    this.broadcast(message);
    return Response.json({ seq: message.seq });
  }

  private broadcast(message: StoredMessage): void {
    const frame = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      const subscriber = subscriberOf(ws);
      if (!subscriber || !receives(message, subscriber)) continue;
      try {
        ws.send(frame);
      } catch {
        // The socket went away mid-broadcast; webSocketClose or webSocketError tidies it up.
      }
    }
  }

  /** Accepts a screen's socket. The Worker has verified its token and passes who it is in headers. */
  // Not `connect`: DurableObject declares that name (outbound TCP sockets).
  private acceptScreen(request: Request): Response {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a websocket upgrade', { status: 426 });
    }
    const role = request.headers.get('x-live-role');
    const sub = request.headers.get('x-live-sub');
    const since = parseSince(request.headers.get('x-live-since'));
    if (!isRole(role) || sub === null || since === undefined) return new Response('bad request', { status: 400 });

    const subscriber: Subscriber = { role, sub: decodeURIComponent(sub) };
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [subscriber.role, subscriber.sub]);
    server.serializeAttachment(subscriber);

    // Everything below runs without yielding, so no publish can slip between the replay and the
    // moment this socket starts receiving broadcasts.
    for (const frame of this.log.replay(subscriber, since)) server.send(JSON.stringify(frame));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Screens only listen; anything they send (apart from the `ping` the runtime answers) is ignored. */
  override webSocketMessage(): void {
    // Intentionally empty.
  }

  override webSocketClose(ws: WebSocket, code: number): void {
    closeQuietly(ws, code);
  }

  override webSocketError(ws: WebSocket): void {
    closeQuietly(ws, 1000);
  }
}
