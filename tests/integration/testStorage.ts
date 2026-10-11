import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

// The object storage of the integration tests: a bucket of their own on the
// local S3Mock (the `storage` service of docker-compose.yml, port 9090); CI
// runs the same image as a service container. setupEnv.ts points the app at it
// whatever .env says, so a test run never touches another bucket.
export const TEST_S3 = {
  endpoint: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:9090',
  region: 'us-east-1',
  bucket: process.env.TEST_S3_BUCKET ?? 'project-accounting-test',
  accessKeyId: 'test',
  secretAccessKey: 'test',
};

// A client of the tests' own, for looking at the bucket behind the app's back.
let client: S3Client | undefined;

function s3(): S3Client {
  client ??= new S3Client({
    endpoint: TEST_S3.endpoint,
    region: TEST_S3.region,
    credentials: { accessKeyId: TEST_S3.accessKeyId, secretAccessKey: TEST_S3.secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return client;
}

export async function listObjectKeys(prefix = ''): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3().send(
      new ListObjectsV2Command({
        Bucket: TEST_S3.bucket,
        Prefix: prefix,
        ...(token ? { ContinuationToken: token } : {}),
      }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: TEST_S3.bucket, Key: key }));
}

// Creates the test bucket if it is missing and empties it. The database is
// rebuilt for every run (globalSetup.ts), so whatever an earlier run left in
// the bucket belongs to rows that no longer exist.
export async function resetTestBucket(): Promise<void> {
  try {
    await s3().send(new HeadBucketCommand({ Bucket: TEST_S3.bucket }));
  } catch {
    await s3().send(new CreateBucketCommand({ Bucket: TEST_S3.bucket }));
  }
  for (const key of await listObjectKeys()) {
    await deleteObject(key);
  }
}
