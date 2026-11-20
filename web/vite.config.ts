import { defineConfig } from 'vitest/config';

// En desarrollo (`npm run dev`) Vite hace de proxy con las mismas rutas que nginx en produccion,
// asi el codigo del navegador siempre llama a /gamestats/... y /prolog/... en su propio origen.
const ingest = process.env.INGEST_URL ?? 'http://localhost:8080';
const analytics = process.env.ANALYTICS_URL ?? 'http://localhost:8081';
const prolog = process.env.PROLOG_URL ?? 'http://localhost:8090';

const quitarPrefijo = (prefijo: string) => (ruta: string) => ruta.slice(prefijo.length) || '/';

export default defineConfig({
  server: {
    proxy: {
      '/gamestats/ingest': { target: ingest, changeOrigin: true, rewrite: quitarPrefijo('/gamestats/ingest') },
      '/gamestats/analytics': { target: analytics, changeOrigin: true, rewrite: quitarPrefijo('/gamestats/analytics') },
      '/prolog': { target: prolog, changeOrigin: true, rewrite: quitarPrefijo('/prolog') },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
