const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');

const processes = [];
let stopped = false;
function shutdown(code = 0) {
  if (stopped) return;
  stopped = true;
  for (const child of processes) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else child.kill('SIGTERM');
  }
  process.exitCode = code;
}
function freePort(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(port, '0.0.0.0', () => probe.close(resolve));
  });
}
process.once('SIGINT', () => shutdown());
process.once('SIGTERM', () => shutdown());

(async () => {
  const roomPort = Number(process.env.PORT || 3000);
  const vitePort = Number(process.env.VITE_PORT || 5173);
  for (const port of [roomPort, vitePort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT and VITE_PORT must be integers from 1 to 65535');
    await freePort(port);
  }
  if (roomPort === vitePort) throw new Error('PORT and VITE_PORT must be different');
  processes.push(
    spawn(process.execPath, [require.resolve('tsx/cli'), 'watch', 'server/dev.ts'], { stdio: 'inherit', windowsHide: true }),
    spawn(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '0.0.0.0'], { stdio: 'inherit', windowsHide: true }),
  );
  for (const child of processes) {
    child.once('error', error => { console.error(error); shutdown(1); });
    child.once('exit', code => shutdown(code || 0));
  }
})().catch(error => {
  console.error(`Cannot start development servers: ${error.message}. Change PORT or VITE_PORT if a service is already running.`);
  shutdown(1);
});
