import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { copyFileSync, cpSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const roomTarget = `http://127.0.0.1:${process.env.PORT || 3000}`;

// Keep the browser build and the original licensed assets at one origin.
export default defineConfig({
  base: './',
  publicDir: false,
  build: { outDir: 'dist/client', emptyOutDir: true },
  plugins: [vue(), {
    name: 'theatre-web-manifest',
    transformIndexHtml: {
      order: 'post',
      // The manifest's relative start URL and icon paths must stay at the app root.
      handler: () => [{ tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' }, injectTo: 'head' }],
    },
  }, {
    name: 'theatre-public-assets',
    apply: 'build',
    closeBundle() {
      const output = resolve('dist/client');
      mkdirSync(output, { recursive: true });
      cpSync('assets', resolve(output, 'assets'), { recursive: true });
      for (const file of ['CREDITS.md', 'manifest.webmanifest']) {
        copyFileSync(file, resolve(output, file));
      }
      // Include every built chunk, font, image and sound, even before it is used.
      // Relative URLs work at both / and a GitHub Pages repository subdirectory.
      const files = readdirSync(output, { recursive: true })
        .map(String).map(file => file.replaceAll('\\', '/'))
        .filter(file => file !== 'sw.js' && statSync(resolve(output, file)).isFile()).sort();
      const template = readFileSync('sw.js', 'utf8');
      const hash = createHash('sha256').update(template);
      for (const file of files) hash.update(file).update(readFileSync(resolve(output, file)));
      const version = hash.digest('hex').slice(0, 16);
      writeFileSync(resolve(output, 'sw.js'), template
        .replace('__BUILD_VERSION__', version)
        .replace('/* __PRECACHE_FILES__ */ []', JSON.stringify(files)));
    },
  }],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: true,
    fs: { allow: [process.cwd()] },
    proxy: {
      '/ws': { target: roomTarget, ws: true },
      '/health': { target: roomTarget },
      '/assets': { target: roomTarget },
      '/CREDITS.md': { target: roomTarget },
      '/manifest.webmanifest': { target: roomTarget },
      '/sw.js': { target: roomTarget },
    },
  },
});
