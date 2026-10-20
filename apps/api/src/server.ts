import { loadConfig } from './config.js';
import { getPool, closePool } from './db/pool.js';
import { buildApp } from './app.js';

async function main() {
  const config = loadConfig();
  getPool();

  const app = buildApp();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down API server gracefully...');
    try {
      await app.close();
      await closePool();
      app.log.info('API server stopped cleanly');
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during API server shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    const address = await app.listen({
      port: config.API_PORT,
      host: '0.0.0.0',
    });
    app.log.info({ address }, `API server listening on ${address}`);
  } catch (err) {
    app.log.error({ err }, 'Failed to start API server');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal API startup error:', err);
  process.exit(1);
});
