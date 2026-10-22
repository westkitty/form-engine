import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const version = process.env.npm_package_version ?? JSON.parse(readFileSync('package.json', 'utf8')).version;
const PUBLIC_SHELL = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png'];

/** Emits sw.js with the exact list of built files to precache, versioned by their content hash. */
function formServiceWorker(): Plugin {
  return {
    name: 'form-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const built = Object.keys(bundle).filter(f => !f.endsWith('.map') && f !== 'sw.js');
      const files = [...new Set(['./', './index.html', ...built.map(f => './' + f), ...PUBLIC_SHELL.map(f => './' + f)])];
      const h = createHash('sha256').update(version + '\n' + built.sort().join('\n')).digest('hex').slice(0, 12);
      const src = readFileSync('src/pwa/sw-template.js', 'utf8')
        .replace("const VERSION = '__VERSION__';", `const VERSION = '${version}-${h}';`)
        .replace('const PRECACHE = __PRECACHE__;', `const PRECACHE = ${JSON.stringify(files, null, 1)};`);
      if (src.includes("'__VERSION__'") || src.includes('= __PRECACHE__')) this.error('sw.js placeholders were not replaced');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

// FORM_BASE controls the public base path (e.g. "/form-engine/" for GitHub Pages project sites).
export default defineConfig({
  base: process.env.FORM_BASE ?? './',
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1200 },
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [formServiceWorker()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as any);
