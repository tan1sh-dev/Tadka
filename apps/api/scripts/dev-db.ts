/**
 * Local MongoDB replica set for development when Docker/Atlas isn't available.
 * Data persists in <repo>/.data/mongo. Transactions work because this is a (single-node) replica set.
 *   npm run dev:db   →   mongodb://127.0.0.1:27017/tadka?replicaSet=rs0
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dbPath = path.join(root, '.data', 'mongo');
fs.mkdirSync(dbPath, { recursive: true });

const rs = await MongoMemoryReplSet.create({
  replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
  instanceOpts: [{ port: 27017, dbPath }],
});
console.log(`\nMongoDB replica set ready → ${rs.getUri('tadka')}\nData directory: ${dbPath}\nPress Ctrl+C to stop.\n`);

const stop = async () => {
  await rs.stop({ doCleanup: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
