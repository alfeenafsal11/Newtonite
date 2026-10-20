export type SortOption = 'activity_desc' | 'priority_due' | 'created_desc';

export interface CursorPayload {
  s: SortOption;
  k: unknown[];
  id: string;
}

export function encodeCursor(sort: SortOption, row: Record<string, unknown>): string {
  let k: unknown[];
  const id = String(row['id']);

  switch (sort) {
    case 'activity_desc': {
      const val = row['last_activity_at'];
      k = [val instanceof Date ? val.toISOString() : String(val)];
      break;
    }
    case 'created_desc': {
      const val = row['created_at'];
      k = [val instanceof Date ? val.toISOString() : String(val)];
      break;
    }
    case 'priority_due': {
      const priority = String(row['priority']);
      const dueAt = row['due_at'];
      k = [priority, dueAt ? (dueAt instanceof Date ? dueAt.toISOString() : String(dueAt)) : null];
      break;
    }
    default:
      throw new Error(`Unsupported sort: ${sort}`);
  }

  const payload: CursorPayload = { s: sort, k, id };
  const json = JSON.stringify(payload);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(expectedSort: SortOption, token: string): CursorPayload {
  if (!token) {
    throw new Error('Cursor token is empty');
  }

  let json: string;
  try {
    json = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    throw new Error('Invalid cursor encoding');
  }

  let payload: CursorPayload;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error('Invalid cursor JSON');
  }

  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Invalid cursor payload');
  }

  if (payload.s !== expectedSort) {
    throw new Error(`Cursor sort '${payload.s}' does not match expected sort '${expectedSort}'`);
  }

  if (!Array.isArray(payload.k) || typeof payload.id !== 'string' || !payload.id) {
    throw new Error('Malformed cursor structure');
  }

  return payload;
}
