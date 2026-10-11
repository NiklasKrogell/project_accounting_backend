// Checks that the object storage the environment points at works: stores a
// small object through the app's own storage code, reads it back, compares the
// two and deletes it.
//
//   npm run storage:check
//
// Run it when a bucket is first configured (Cloudflare R2 in production). The
// S3Mock used in development and tests takes any credentials and checks no
// signatures, so this is what proves a real configuration.
import { randomBytes, randomUUID } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { env } from '../src/config/env';
import { objectStorage } from '../src/lib/objectStorage';

async function main(): Promise<void> {
  // Stand-ins for a company and a file, so the object goes where a real one
  // would.
  const companyId = randomUUID();
  const content = randomBytes(1024);
  console.log(`Checking bucket "${env.S3_BUCKET}" at ${env.S3_ENDPOINT}`);

  const key = await objectStorage.put(companyId, randomUUID(), content, 'application/octet-stream');
  console.log(`  stored   ${key}`);
  try {
    const object = await objectStorage.get(companyId, key);
    if (!object) throw new Error('The object just stored was not found');
    const read = await buffer(object.body);
    if (!read.equals(content)) throw new Error('The object read back differs from the one stored');
    console.log(`  read     ${read.length} bytes, identical`);
  } finally {
    await objectStorage.delete(companyId, key);
    console.log('  deleted');
  }
  if (await objectStorage.get(companyId, key)) {
    throw new Error('The object is still there after deleting it');
  }
  console.log('Object storage works.');
}

main().catch((err) => {
  console.error('Object storage check failed:');
  console.error(err);
  process.exitCode = 1;
});
