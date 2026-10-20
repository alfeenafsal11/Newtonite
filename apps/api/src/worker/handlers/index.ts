import pg from 'pg';
import { handleNotifyWatchers, type EventWithItem } from './notify-watchers.js';
import { handleNotifyApprovers } from './notify-approvers.js';

export type HandlerFn = (event: EventWithItem, db: pg.PoolClient | pg.Pool) => Promise<void>;

export const HANDLERS: Record<string, HandlerFn> = {
  notify_watchers: handleNotifyWatchers,
  notify_approvers: handleNotifyApprovers,
};

export { handleNotifyWatchers, handleNotifyApprovers };
export type { EventWithItem };
