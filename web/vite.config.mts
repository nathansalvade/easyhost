import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = 'http://localhost:3000';

export default defineConfig({
  root: here,
  plugins: [react()],
  build: { outDir: path.resolve(here, 'dist'), emptyOutDir: true },
  server: { proxy: { '/api': backend, '/health': backend, '/catalog-icons': backend } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(here, 'src/test/setup.ts')],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
