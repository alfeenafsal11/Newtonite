import pg from 'pg';

export interface EventWithItem {
  id: number;
  item_id: string;
  team_id: string;
  actor_id: string | null;
  type: string;
  payload: Record<string, any>;
  created_at: Date;
}

export async function handleNotifyWatchers(
  event: EventWithItem,
  db: pg.PoolClient | pg.Pool
): Promise<void> {
  // Find all watchers on the item, excluding the actor who triggered the event
  const watchersRes = await db.query<{ user_id: string }>(
    `SELECT user_id
     FROM item_watchers
     WHERE item_id = $1
       AND ($2::uuid IS NULL OR user_id != $2::uuid)`,
    [event.item_id, event.actor_id]
  );

  if (watchersRes.rows.length === 0) {
    return;
  }

  for (const row of watchersRes.rows) {
    await db.query(
      `INSERT INTO notifications (user_id, item_id, event_id, kind)
       VALUES ($1, $2, $3, 'watcher')
       ON CONFLICT (user_id, event_id, kind) DO NOTHING`,
      [row.user_id, event.item_id, event.id]
    );
  }
}
