import { createGameServer } from './index';

const app = createGameServer({ assetRoot: process.cwd() });
void app.listen().then(address => {
  console.log(`Room server: http://${address.address}:${address.port}`);
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
const shutdown = () => { void app.close(); };
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
