import { defineConfig } from 'vite';
// FORM_BASE controls the public base path (e.g. "/form-engine/" for GitHub Pages project sites).
export default defineConfig({
  base: process.env.FORM_BASE ?? './',
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1200 },
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0') },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as any);
