// Small CommonJS entrypoint for Node, systemd and existing deployment tools.
// Runtime code is compiled from server/index.ts and shared/combat.ts.
const path = require('node:path');
const runtime = require('./dist/server/index.cjs');
function createGameServer(options = {}) {
  return runtime.createGameServer({ staticRoot: path.join(__dirname, 'dist/client'), ...options });
}
module.exports = { ...runtime, createGameServer };
if (require.main === module) {
  const app = createGameServer();
  app.listen().then(address => console.log(`Game server listening on http://${address.address}:${address.port}`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
  const shutdown = () => { void app.close().then(() => { process.exitCode = 0; }); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
