const { buildSync } = require('esbuild');
buildSync({
  entryPoints: ['server/index.ts'],
  outfile: 'dist/server/index.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['ws'],
  sourcemap: false,
});
console.log('Built TypeScript room server: dist/server/index.cjs');
