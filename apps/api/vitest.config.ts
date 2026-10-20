import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ['test/**/*.test.ts'],
    globals: true,
    fileParallelism: false,
  },
});
