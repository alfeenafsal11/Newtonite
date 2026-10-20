import { z } from 'zod';

const configSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_URL_TEST: z.string().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_TTL_HOURS: z.coerce.number().default(8),
  API_PORT: z.coerce.number().default(3000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.string().default('info'),
  PG_POOL_MAX: z.coerce.number().default(20),
  SSE_MAX_CONNECTIONS: z.coerce.number().default(2000),
  WORKER_BATCH: z.coerce.number().default(50),
  WORKER_POLL_MS: z.coerce.number().default(1000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().default(8),
  OUTBOX_LOCK_SECONDS: z.coerce.number().default(60),
  STALE_HOURS_P0: z.coerce.number().default(2),
  STALE_HOURS_P1: z.coerce.number().default(24),
  STALE_HOURS_P2: z.coerce.number().default(72),
  STALE_HOURS_P3: z.coerce.number().default(168),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),
  AUTO_CLOSE_DAYS: z.coerce.number().default(7),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(600),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().default(10),
  NODE_ENV: z.string().default('development'),
});

export type Config = z.infer<typeof configSchema>;

let cachedConfig: Config | null = null;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  if (cachedConfig && env === process.env) {
    return cachedConfig;
  }
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Configuration error: ${issues}`);
  }
  if (env === process.env) {
    cachedConfig = parsed.data;
  }
  return parsed.data;
}
