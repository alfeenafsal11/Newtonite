import crypto from 'node:crypto';
import pg from 'pg';
import { Actor } from '../domain/permissions.js';
import { AppError } from './errors.js';
import { withTx } from '../db/tx.js';

export interface IdempotencyResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map((k) => JSON.stringify(k) + ':' + canonicalJson((obj as Record<string, unknown>)[k]));
  return '{' + entries.join(',') + '}';
}

export function computeRequestFingerprint(method: string, path: string, body: unknown): string {
  const normMethod = method.toUpperCase();
  const normPath = path.toLowerCase();
  const normBody = canonicalJson(body ?? {});
  const raw = `${normMethod}|${normPath}|${normBody}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function withIdempotency<T>(
  actor: Actor,
  key: string | undefined,
  fingerprint: string,
  work: (client: pg.PoolClient) => Promise<{ status: number; body: T }>
): Promise<IdempotencyResult<T>> {
  if (!key || typeof key !== 'string') {
    throw new AppError(400, 'idempotency_key_required', 'Idempotency-Key header is required for mutating requests');
  }

  const trimmedKey = key.trim();
  if (trimmedKey.length < 8 || trimmedKey.length > 128) {
    throw new AppError(400, 'validation_error', 'Idempotency-Key must be between 8 and 128 characters');
  }

  return await withTx(async (client) => {
    // Attempt to insert key
    const insertRes = await client.query(
      `INSERT INTO idempotency_keys (user_id, key, request_fingerprint)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, key) DO NOTHING
       RETURNING 1`,
      [actor.id, trimmedKey, fingerprint]
    );

    if (insertRes.rows.length === 0) {
      // Row already existed and was committed
      const existingRes = await client.query(
        `SELECT request_fingerprint, response_status, response_body
         FROM idempotency_keys
         WHERE user_id = $1 AND key = $2`,
        [actor.id, trimmedKey]
      );

      if (existingRes.rows.length === 0) {
        throw new AppError(500, 'internal', 'Idempotency state inconsistency');
      }

      const existing = existingRes.rows[0];
      if (existing.request_fingerprint !== fingerprint) {
        throw new AppError(
          422,
          'idempotency_key_reuse',
          'Idempotency key was previously used with a different request payload'
        );
      }

      // If existing has a response, replay it
      if (existing.response_status != null && existing.response_body != null) {
        return {
          status: existing.response_status,
          body: existing.response_body as T,
          replayed: true,
        };
      }
    }

    // Execute business logic in the same transaction
    const result = await work(client);

    // Only 2xx responses are persisted under the idempotency key
    if (result.status >= 200 && result.status < 300) {
      await client.query(
        `UPDATE idempotency_keys
         SET response_status = $1, response_body = $2
         WHERE user_id = $3 AND key = $4`,
        [result.status, JSON.stringify(result.body), actor.id, trimmedKey]
      );
    }

    return {
      status: result.status,
      body: result.body,
      replayed: false,
    };
  });
}
