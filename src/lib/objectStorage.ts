import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from '../config/env';
import { companyObjectKey, keyBelongsToCompany } from './storageKey';

// Object storage over the S3 API: Cloudflare R2 in production, the S3Mock
// container of docker-compose.yml in development and tests. The bucket is
// private and this module is the only code that talks to it: no client is ever
// handed a key, a credential or a URL into it.
//
// Every call names the company it acts for and takes only that company's keys,
// so a caller can't reach another company's objects even with a key it should
// never have had (the StoredFile table has a CHECK constraint to the same end).

const client = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
  // endpoint/bucket/key rather than bucket.endpoint/key: R2 takes both, S3Mock
  // only this.
  forcePathStyle: true,
  // Left alone, the SDK adds a CRC32 checksum of its own to every request,
  // which not every S3-compatible store accepts. A stored file carries a
  // sha256 of its own.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
  // socketTimeout is how long a connection may sit idle, not how long a
  // transfer may take. It also ends a download whose client has stopped
  // reading, since the object is only read as fast as the client takes it.
  requestHandler: { connectionTimeout: 5_000, socketTimeout: 60_000 },
});

// A delete is a small request, and the one made while a database transaction
// is open (storedFileService.remove), so it doesn't wait long for an answer.
const DELETE_TIMEOUT_MS = 3_000;

function assertOwnKey(companyId: string, key: string): void {
  if (!keyBelongsToCompany(key, companyId)) {
    throw new Error(`Storage key is outside the prefix of company ${companyId}`);
  }
}

export interface StoredObject {
  body: Readable;
  contentLength: number | undefined;
}

export const objectStorage = {
  // Stores the content as the company's file `fileId` and returns its key.
  async put(
    companyId: string,
    fileId: string,
    content: Buffer,
    contentType: string,
  ): Promise<string> {
    const key = companyObjectKey(companyId, fileId);
    await client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: content,
        ContentType: contentType,
      }),
    );
    return key;
  },

  // Null when there is no such object. Any other failure is thrown, a missing
  // bucket included: a storage that doesn't work must not look like a file
  // that doesn't exist.
  async get(companyId: string, key: string): Promise<StoredObject | null> {
    assertOwnKey(companyId, key);
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      if (!object.Body) throw new Error('Object storage answered without a body');
      return { body: object.Body as Readable, contentLength: object.ContentLength };
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      throw err;
    }
  },

  // Deleting an object that is already gone succeeds.
  async delete(companyId: string, key: string): Promise<void> {
    assertOwnKey(companyId, key);
    await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), {
      abortSignal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
    });
  },
};
