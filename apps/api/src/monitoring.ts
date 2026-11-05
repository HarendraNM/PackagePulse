import 'dotenv/config';
import { Redis } from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { githubInfo, healthScore, npmPackage, osvScan, repoUrl } from './services.js';

export const MONITOR_QUEUE = 'packagepulse-monitoring';
const configuredIntervalMs = Number(process.env.MONITOR_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
export const monitorIntervalMs = Number.isFinite(configuredIntervalMs) && configuredIntervalMs > 0
  ? Math.min(30 * 86400_000, Math.max(60_000, configuredIntervalMs))
  : 6 * 60 * 60 * 1000;
const prisma = new PrismaClient();

export async function checkPackage(packageName: string) {
  const now = new Date();
  try {
    const meta = await npmPackage(packageName);
    const version = meta['dist-tags']?.latest;
    if (typeof version !== 'string' || !version) throw new Error('Latest npm version is unavailable');
    const github = await githubInfo(repoUrl(meta.repository));
    const [health, security] = await Promise.all([
      Promise.resolve(healthScore(meta, github)),
      osvScan(packageName, version)
    ]);
    const vulnerabilityIds = security.vulnerabilities.map((v: { id: string }) => v.id);
    await prisma.$transaction([
      prisma.packageSnapshot.create({
        data: {
          packageName,
          version,
          healthScore: health.score,
          securitySummary: { scannedVersion: version, vulnerabilityIds, count: vulnerabilityIds.length }
        }
      }),
      prisma.trackedPackage.updateMany({ where: { packageName }, data: { lastCheckedAt: now, lastError: null } })
    ]);
    return { packageName, version, healthScore: health.score, vulnerabilityIds };
  } catch (error) {
    let message = error instanceof Error ? error.message : 'Package check failed';
    for (const secret of [process.env.DATABASE_URL, process.env.DIRECT_URL]) if(secret) message=message.replaceAll(secret,'[redacted]');
    message=message.slice(0,500);
    await prisma.trackedPackage.updateMany({ where: { packageName }, data: { lastCheckedAt: now, lastError: message } });
    throw error;
  }
}

export async function discoverAndQueue(queue: Queue) {
  const names = await prisma.trackedPackage.findMany({
    where: { monitoringEnabled: true },
    distinct: ['packageName'],
    select: { packageName: true }
  });
  const bucket = Math.floor(Date.now() / monitorIntervalMs);
  await queue.addBulk(names.map(({ packageName }) => ({
    name: 'check-package',
    data: { packageName },
    opts: { jobId: `pkg-${encodeURIComponent(packageName)}-${bucket}`, attempts: 3, backoff: { type: 'exponential', delay: 10_000 } }
  })));
  await prisma.packageSnapshot.deleteMany({ where: { collectedAt: { lt: new Date(Date.now() - 90 * 86400_000) } } });
  return names.length;
}

export async function startMonitorWorker() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is required for the BullMQ monitoring worker');
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
  const queue = new Queue(MONITOR_QUEUE, {
    connection,
    defaultJobOptions: { removeOnComplete: 500, removeOnFail: 500 }
  });
  const worker = new Worker(MONITOR_QUEUE, async job => {
    if (job.name === 'discover-packages') {
      const count = await discoverAndQueue(queue);
      console.info(`Queued checks for ${count} tracked package(s).`);
      return { queued: count };
    }
    if (job.name === 'check-package' && typeof job.data.packageName === 'string') {
      return checkPackage(job.data.packageName);
    }
    throw new Error(`Unknown monitoring job: ${job.name}`);
  }, { connection, concurrency: 4 });
  worker.on('failed', job => console.error(`Monitoring job failed: ${job?.name} (${job?.attemptsMade} attempts).`));
  await queue.upsertJobScheduler('discover-tracked-packages', { every: monitorIntervalMs }, { name: 'discover-packages', data: {} });
  await queue.add('discover-packages', {}, { jobId: `discover-initial-${Date.now()}` });
  console.info(`Package monitoring worker started; interval ${monitorIntervalMs}ms.`);
  return { worker, queue, connection };
}

export async function runDevelopmentMonitorCycle() {
  const names = await prisma.trackedPackage.findMany({ where: { monitoringEnabled: true }, distinct: ['packageName'], select: { packageName: true } });
  const results = await Promise.allSettled(names.map(x => checkPackage(x.packageName)));
  console.info(`Development monitor checked ${results.filter(x => x.status === 'fulfilled').length}/${names.length} package(s).`);
}
