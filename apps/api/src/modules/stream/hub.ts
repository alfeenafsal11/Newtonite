import pg from 'pg';
import crypto from 'node:crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Actor } from '../../domain/permissions.js';
import { getPool } from '../../db/pool.js';

export interface SseConnection {
  id: string;
  userId: string;
  tokenVersion: number;
  teamIds: Set<string>;
  isWildcard: boolean;
  reply: FastifyReply;
  lastRefreshedAt: number;
}

export class StreamHub {
  private connections = new Map<string, SseConnection>();
  private listenerClient: pg.Client | null = null;
  private dbUrl: string;
  private maxConnections: number;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;
  private isStopping = false;

  constructor(dbUrl: string, maxConnections = 1000) {
    this.dbUrl = dbUrl;
    this.maxConnections = maxConnections;
  }

  public async start(): Promise<void> {
    await this.connectListener();

    // Heartbeat every 25 seconds
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 25000);

    // Membership refresh check every 30 seconds
    this.refreshInterval = setInterval(() => {
      this.refreshStaleConnections();
    }, 30000);
  }

  public async stop(): Promise<void> {
    this.isStopping = true;
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.refreshInterval) clearInterval(this.refreshInterval);

    for (const conn of this.connections.values()) {
      try {
        conn.reply.raw.end();
      } catch {
        // ignore
      }
    }
    this.connections.clear();

    if (this.listenerClient) {
      try {
        await this.listenerClient.end();
      } catch {
        // ignore
      }
      this.listenerClient = null;
    }
  }

  private async connectListener(): Promise<void> {
    if (this.isStopping) return;

    try {
      this.listenerClient = new pg.Client({ connectionString: this.dbUrl });
      await this.listenerClient.connect();

      this.listenerClient.on('notification', (msg) => {
        if (msg.channel === 'item_changed' && msg.payload) {
          try {
            const data = JSON.parse(msg.payload);
            this.broadcast(data);
          } catch {
            // invalid JSON payload, ignore
          }
        }
      });

      this.listenerClient.on('error', (err) => {
        console.error('[StreamHub] Listener error, reconnecting...', err);
        if (!this.isStopping) {
          setTimeout(() => this.connectListener(), 2000);
        }
      });

      await this.listenerClient.query('LISTEN item_changed');
    } catch (err) {
      console.error('[StreamHub] Failed to connect listener, retrying...', err);
      if (!this.isStopping) {
        setTimeout(() => this.connectListener(), 3000);
      }
    }
  }

  public register(
    actor: Actor,
    request: FastifyRequest,
    reply: FastifyReply
  ): boolean {
    if (this.connections.size >= this.maxConnections) {
      return false;
    }

    const connectionId = crypto.randomUUID();
    const isWildcard = actor.orgRole === 'org_admin' || actor.orgRole === 'auditor';
    const teamIds = new Set<string>();

    for (const [teamId] of actor.memberships) {
      teamIds.add(teamId);
    }

    const conn: SseConnection = {
      id: connectionId,
      userId: actor.id,
      tokenVersion: 0,
      teamIds,
      isWildcard,
      reply,
      lastRefreshedAt: Date.now(),
    };

    this.connections.set(connectionId, conn);

    request.raw.on('close', () => {
      this.connections.delete(connectionId);
    });

    return true;
  }

  public broadcast(payload: {
    item_id: string;
    team_id: string;
    version: number;
    type: string;
    event_id?: number | string;
  }): void {
    const sseMessage = `event: item_changed\ndata: ${JSON.stringify(payload)}\n\n`;

    for (const conn of this.connections.values()) {
      if (conn.isWildcard || conn.teamIds.has(payload.team_id)) {
        try {
          conn.reply.raw.write(sseMessage);
        } catch {
          this.connections.delete(conn.id);
        }
      }
    }
  }

  private sendHeartbeat(): void {
    const heartbeat = `: heartbeat\n\n`;
    for (const conn of this.connections.values()) {
      try {
        conn.reply.raw.write(heartbeat);
      } catch {
        this.connections.delete(conn.id);
      }
    }
  }

  private async refreshStaleConnections(): Promise<void> {
    const now = Date.now();
    const pool = getPool();

    for (const conn of this.connections.values()) {
      // Refresh every 60 seconds
      if (now - conn.lastRefreshedAt >= 60000) {
        conn.lastRefreshedAt = now;
        try {
          const userRes = await pool.query<{ token_version: number; is_active: boolean }>(
            `SELECT token_version, is_active FROM users WHERE id = $1`,
            [conn.userId]
          );
          if (
            userRes.rows.length === 0 ||
            !userRes.rows[0]?.is_active
          ) {
            conn.reply.raw.end();
            this.connections.delete(conn.id);
            continue;
          }

          if (!conn.isWildcard) {
            const tmRes = await pool.query<{ team_id: string }>(
              `SELECT team_id FROM team_memberships WHERE user_id = $1`,
              [conn.userId]
            );
            conn.teamIds = new Set(tmRes.rows.map((r) => r.team_id));
          }
        } catch {
          // ignore transient error
        }
      }
    }
  }

  public get activeConnectionCount(): number {
    return this.connections.size;
  }
}

let globalHub: StreamHub | null = null;

export function getStreamHub(dbUrl?: string, maxConnections?: number): StreamHub {
  if (!globalHub) {
    if (!dbUrl) throw new Error('StreamHub not initialized with database URL');
    globalHub = new StreamHub(dbUrl, maxConnections);
  }
  return globalHub;
}
