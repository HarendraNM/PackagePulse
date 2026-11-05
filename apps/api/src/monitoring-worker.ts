import { startMonitorWorker } from './monitoring.js';

const runtime = await startMonitorWorker();
const shutdown = async () => {
  await runtime.worker.close();
  await runtime.queue.close();
  await runtime.connection.quit();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
