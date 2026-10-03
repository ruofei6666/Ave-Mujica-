const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
if (!fs.existsSync('dist/client/index.html') || !fs.existsSync('dist/server/index.cjs')) {
  console.log('Building the Vue client and room server for first launch…');
  const windows = process.platform === 'win32';
  const result = spawnSync(windows ? (process.env.ComSpec || 'cmd.exe') : 'pnpm', windows ? ['/d', '/s', '/c', 'pnpm run build'] : ['run', 'build'], {
    stdio: 'inherit', windowsHide: true,
  });
  if (result.error) console.error(`Cannot build the game: ${result.error.message}. Install pnpm 11.25.0 and run pnpm install --frozen-lockfile.`);
  process.exitCode = result.status ?? 1;
}
