import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { parseDateOnly } from '../../src/lib/dateOnly';
import { MAX_FILE_SIZE_BYTES } from '../../src/lib/fileType';
import { objectStorage } from '../../src/lib/objectStorage';
import { companyKeyPrefix, companyObjectKey } from '../../src/lib/storageKey';
import { fiscalYearService } from '../../src/services/fiscal-year.service';
import { accountingPeriodService } from '../../src/services/accounting-period.service';
import { journalEntryService } from '../../src/services/journal-entry.service';
import { addMember, createAccount, createTestContext } from './helpers';
import { deleteObject, listObjectKeys, resetTestBucket } from './testStorage';

// Runs against the S3Mock of docker-compose.yml (see testStorage.ts): the files
// really go through the S3 API into a bucket, and the tests look into that
// bucket on their own to see what the app left there.

const app = createApp();

// The least that passes for each type: its signature and a few more bytes.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'latin1');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('ei oikeasti kuva'),
]);

const FILE_NOT_FOUND = { error: { message: 'File not found' } };

const sha256 = (content: Buffer) => createHash('sha256').update(content).digest('hex');

type TestContext = Awaited<ReturnType<typeof createTestContext>>;

let cookie: string;
let companyId: string;
let userId: string;
let other: TestContext;

interface UploadOptions {
  content?: Buffer;
  filename?: string;
  // What the client says the file is; the server is expected not to care.
  claimedType?: string;
  fields?: Record<string, string>;
}

function upload(as: string, options: UploadOptions = {}) {
  const req = request(app).post('/api/files').set('Cookie', as);
  for (const [name, value] of Object.entries(options.fields ?? {})) {
    req.field(name, value);
  }
  return req.attach('file', options.content ?? PDF, {
    filename: options.filename ?? 'kuitti.pdf',
    contentType: options.claimedType ?? 'application/pdf',
  });
}

async function uploadedFileId(as: string, options: UploadOptions = {}): Promise<string> {
  const res = await upload(as, options);
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

const getFile = (as: string, id: string) => request(app).get(`/api/files/${id}`).set('Cookie', as);
const getContent = (as: string, id: string) =>
  request(app).get(`/api/files/${id}/content`).set('Cookie', as);
const linkFile = (as: string, id: string, journalEntryId: string | null) =>
  request(app).patch(`/api/files/${id}`).set('Cookie', as).send({ journalEntryId });
const deleteFile = (as: string, id: string) =>
  request(app).delete(`/api/files/${id}`).set('Cookie', as);

const objectsOf = (ofCompanyId: string) => listObjectKeys(companyKeyPrefix(ofCompanyId));

// Expected failures are logged by the app; keep them out of the test output.
const silenceErrorLog = () => vi.spyOn(console, 'error').mockImplementation(() => {});

beforeAll(async () => {
  await resetTestBucket();
  const ctx = await createTestContext('ADMIN');
  cookie = ctx.cookie;
  companyId = ctx.company.id;
  userId = ctx.user.id;
  other = await createTestContext('ADMIN');
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/files', () => {
  it("stores the file under its company's prefix and answers with its details", async () => {
    const res = await upload(cookie, { filename: 'lasku_päivä.pdf' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      originalName: 'lasku_päivä.pdf',
      mimeType: 'application/pdf',
      size: PDF.length,
      sha256: sha256(PDF),
      journalEntryId: null,
      uploadedById: userId,
    });
    // Neither the storage key nor the company is anything a client is told.
    expect(Object.keys(res.body.data).sort()).toEqual([
      'createdAt',
      'id',
      'journalEntryId',
      'mimeType',
      'originalName',
      'purchaseInvoiceId',
      'sha256',
      'size',
      'uploadedById',
    ]);

    const id = res.body.data.id as string;
    const row = await prisma.storedFile.findUniqueOrThrow({ where: { id } });
    expect(row.companyId).toBe(companyId);
    expect(row.storageKey).toBe(`companies/${companyId}/${id}`);
    expect(await objectsOf(companyId)).toContain(row.storageKey);
    expect(await objectsOf(other.company.id)).toEqual([]);
  });

  it('takes the type from the content, not from what the client claims', async () => {
    const res = await upload(cookie, {
      content: PNG,
      filename: 'kuva.pdf',
      claimedType: 'application/pdf',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.mimeType).toBe('image/png');
  });

  it('keeps only the base name of the file', async () => {
    const res = await request(app)
      .post('/api/files')
      .set('Cookie', cookie)
      .attach('file', PDF, { filepath: 'kansio/ali/kuitti.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.data.originalName).toBe('kuitti.pdf');
  });

  it('refuses content that is not a storable type, whatever it is called', async () => {
    const fresh = await createTestContext('ADMIN');
    const html = await upload(fresh.cookie, {
      content: Buffer.from('<!doctype html><script>alert(1)</script>'),
      filename: 'lasku.pdf',
    });
    expect(html.status).toBe(415);
    const executable = await upload(fresh.cookie, {
      content: Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1'),
      filename: 'kuitti.png',
      claimedType: 'image/png',
    });
    expect(executable.status).toBe(415);

    expect(await prisma.storedFile.count({ where: { companyId: fresh.company.id } })).toBe(0);
    expect(await objectsOf(fresh.company.id)).toEqual([]);
  });

  it('refuses a request without a usable file with 400', async () => {
    const json = await request(app).post('/api/files').set('Cookie', cookie).send({ file: 'x' });
    expect(json.status).toBe(400);

    const noFile = await request(app)
      .post('/api/files')
      .set('Cookie', cookie)
      .field('journalEntryId', '');
    expect(noFile.status).toBe(400);

    const empty = await upload(cookie, { content: Buffer.alloc(0) });
    expect(empty.status).toBe(400);
    expect(empty.body.error.message).toBe('File is empty');

    const wrongField = await request(app)
      .post('/api/files')
      .set('Cookie', cookie)
      .attach('liite', PDF, { filename: 'kuitti.pdf', contentType: 'application/pdf' });
    expect(wrongField.status).toBe(400);

    const twoFiles = await request(app)
      .post('/api/files')
      .set('Cookie', cookie)
      .attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' })
      .attach('file', PDF, { filename: 'b.pdf', contentType: 'application/pdf' });
    expect(twoFiles.status).toBe(400);
  });

  it('takes a file of exactly the size limit and refuses one a byte over with 413', async () => {
    const fresh = await createTestContext('ADMIN');
    const atLimit = Buffer.concat([PDF, Buffer.alloc(MAX_FILE_SIZE_BYTES - PDF.length)]);

    const accepted = await upload(fresh.cookie, { content: atLimit });
    expect(accepted.status).toBe(201);
    expect(accepted.body.data.size).toBe(MAX_FILE_SIZE_BYTES);
    expect((await deleteFile(fresh.cookie, accepted.body.data.id)).status).toBe(204);

    const tooLarge = await upload(fresh.cookie, {
      content: Buffer.concat([atLimit, Buffer.alloc(1)]),
    });
    expect(tooLarge.status).toBe(413);
    expect(await objectsOf(fresh.company.id)).toEqual([]);
  });
});

describe('GET /api/files/:id/content', () => {
  it('sends the bytes back as a download under the stored name', async () => {
    const id = await uploadedFileId(cookie, { filename: 'lasku_päivä.pdf' });
    const res = await getContent(cookie, id).responseType('blob');

    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-length']).toBe(String(PDF.length));
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="lasku_p_iv_.pdf"; filename*=UTF-8''lasku_p%C3%A4iv%C3%A4.pdf`,
    );
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sends the detected type even when the name says otherwise', async () => {
    const id = await uploadedFileId(cookie, { content: PNG, filename: 'kuva.pdf' });
    const res = await getContent(cookie, id).responseType('blob');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);
  });

  it('answers 404 when the object is gone from storage, and keeps the details', async () => {
    silenceErrorLog();
    const id = await uploadedFileId(cookie);
    await deleteObject(companyObjectKey(companyId, id));

    const content = await getContent(cookie, id);
    expect(content.status).toBe(404);
    expect(content.body).toEqual(FILE_NOT_FOUND);
    expect((await getFile(cookie, id)).status).toBe(200);
  });
});

describe('company isolation', () => {
  it("answers another company's member exactly as for a file that does not exist", async () => {
    const id = await uploadedFileId(cookie);

    // The file of another company, an id nobody has and something that is
    // not an id at all: the same answer every time, on every route.
    for (const target of [id, randomUUID(), 'not-an-id']) {
      const answers = [
        await getFile(other.cookie, target),
        await getContent(other.cookie, target),
        await linkFile(other.cookie, target, null),
        await deleteFile(other.cookie, target),
      ];
      for (const res of answers) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(FILE_NOT_FOUND);
      }
    }

    // Nothing happened to the file.
    const mine = await getContent(cookie, id).responseType('blob');
    expect(mine.status).toBe(200);
    expect(Buffer.compare(mine.body as Buffer, PDF)).toBe(0);
    expect(await objectsOf(companyId)).toContain(companyObjectKey(companyId, id));
  });

  it("lists only the caller's own company's files", async () => {
    const mine = await uploadedFileId(cookie);
    const theirs = await uploadedFileId(other.cookie);

    const res = await request(app).get('/api/files').set('Cookie', other.cookie);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((file: { id: string }) => file.id);
    expect(ids).toContain(theirs);
    expect(ids).not.toContain(mine);
    expect(res.body.meta.total).toBe(
      await prisma.storedFile.count({ where: { companyId: other.company.id } }),
    );
  });

  it('follows the active company of a user who belongs to both', async () => {
    const mine = await uploadedFileId(cookie);
    const theirs = await uploadedFileId(other.cookie);
    // A member of the other company who is also let into this one.
    const both = await addMember(other.company.id, 'ADMIN');
    await prisma.companyUser.create({ data: { userId: both.user.id, companyId, role: 'ADMIN' } });

    expect((await getContent(both.cookie, theirs)).status).toBe(200);
    const notActive = await getContent(both.cookie, mine);
    expect(notActive.status).toBe(404);
    expect(notActive.body).toEqual(FILE_NOT_FOUND);

    const switched = await request(app)
      .post('/api/auth/switch-company')
      .set('Cookie', both.cookie)
      .send({ companyId });
    expect(switched.status).toBe(200);

    expect((await getContent(both.cookie, mine)).status).toBe(200);
    expect((await getContent(both.cookie, theirs)).status).toBe(404);
  });

  it('stops answering a member the moment they are removed from the company', async () => {
    const id = await uploadedFileId(cookie);
    const member = await addMember(companyId, 'VIEWER');
    expect((await getContent(member.cookie, id)).status).toBe(200);

    await prisma.companyUser.delete({
      where: { userId_companyId: { userId: member.user.id, companyId } },
    });
    // The shared gate's answer for a session without a company; not a word
    // about the file.
    const res = await getContent(member.cookie, id);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('No active company selected');
  });

  it('cannot hold a row whose key lies under another company', async () => {
    const id = randomUUID();
    await expect(
      prisma.storedFile.create({
        data: {
          id,
          companyId,
          storageKey: companyObjectKey(other.company.id, id),
          originalName: 'vieras.pdf',
          mimeType: 'application/pdf',
          size: PDF.length,
          sha256: sha256(PDF),
          uploadedById: userId,
        },
      }),
    ).rejects.toThrow();
    expect(await prisma.storedFile.count({ where: { id } })).toBe(0);
  });

  it("does not let the storage be asked for another company's object", async () => {
    const theirs = await uploadedFileId(other.cookie);
    const foreignKey = companyObjectKey(other.company.id, theirs);

    await expect(objectStorage.get(companyId, foreignKey)).rejects.toThrow();
    await expect(objectStorage.delete(companyId, foreignKey)).rejects.toThrow();
    expect(await objectsOf(other.company.id)).toContain(foreignKey);
  });
});

describe('roles and the shared gates', () => {
  it('lets a VIEWER read but answers 403 to uploading, linking and deleting', async () => {
    const id = await uploadedFileId(cookie);
    const viewer = await addMember(companyId, 'VIEWER');

    expect((await request(app).get('/api/files').set('Cookie', viewer.cookie)).status).toBe(200);
    expect((await getFile(viewer.cookie, id)).status).toBe(200);
    expect((await getContent(viewer.cookie, id)).status).toBe(200);

    expect((await upload(viewer.cookie)).status).toBe(403);
    expect((await linkFile(viewer.cookie, id, null)).status).toBe(403);
    expect((await deleteFile(viewer.cookie, id)).status).toBe(403);
    // The role is checked before anything is looked up, so the answer is the
    // same for an id that leads nowhere.
    expect((await deleteFile(viewer.cookie, randomUUID())).status).toBe(403);
    expect((await getFile(cookie, id)).status).toBe(200);
  });

  it('lets a LEDGER upload and delete', async () => {
    const ledger = await addMember(companyId, 'LEDGER');
    const id = await uploadedFileId(ledger.cookie);
    expect((await deleteFile(ledger.cookie, id)).status).toBe(204);
  });

  it('answers 401 without a session and 402 without an active subscription', async () => {
    const lapsed = await createTestContext('ADMIN');
    const id = await uploadedFileId(lapsed.cookie);

    expect((await request(app).get(`/api/files/${id}/content`)).status).toBe(401);
    expect(
      (await request(app).post('/api/files').attach('file', PDF, { filename: 'kuitti.pdf' })).status,
    ).toBe(401);

    await prisma.company.update({
      where: { id: lapsed.company.id },
      data: { subscriptionStatus: 'CANCELED' },
    });
    expect((await getContent(lapsed.cookie, id)).status).toBe(402);
    expect((await upload(lapsed.cookie)).status).toBe(402);
  });

  it('refuses an upload sent from another site', async () => {
    const fresh = await createTestContext('ADMIN');
    const res = await upload(fresh.cookie).set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Origin not allowed');
    expect(await objectsOf(fresh.company.id)).toEqual([]);
  });
});

describe('files of a journal entry', () => {
  // FY 2025 with monthly periods. The February entry gets its file while the
  // month is still open; then February is closed.
  let januaryEntryId: string;
  let februaryEntryId: string;
  let februaryFileId: string;
  let foreignEntryId: string;

  async function createEntry(inCompanyId: string, byUserId: string, date: string) {
    const bank = await createAccount(inCompanyId, 'Pankkitili');
    const expense = await createAccount(inCompanyId, 'Kulut');
    const entry = await journalEntryService.create(inCompanyId, byUserId, {
      voucherType: 'MEMOVOUCHER',
      date: parseDateOnly(date),
      description: 'Tosite liitteineen',
      accountId: bank.id,
      lines: [
        { accountId: expense.id, amount: 100, description: '', type: 'debit', vatRate: 0 },
        { accountId: bank.id, amount: 100, description: '', type: 'credit', vatRate: 0 },
      ],
    });
    return entry.id;
  }

  async function openFiscalYear2025(inCompanyId: string) {
    return fiscalYearService.create(inCompanyId, {
      startDate: parseDateOnly('2025-01-01'),
      endDate: parseDateOnly('2025-12-31'),
      granularity: 'MONTH',
    });
  }

  beforeAll(async () => {
    const fy = await openFiscalYear2025(companyId);
    januaryEntryId = await createEntry(companyId, userId, '2025-01-15');
    februaryEntryId = await createEntry(companyId, userId, '2025-02-10');
    februaryFileId = await uploadedFileId(cookie, { fields: { journalEntryId: februaryEntryId } });
    const february = fy.periods.find((p) => p.index === 2)!;
    await accountingPeriodService.closePeriod(companyId, february.id);

    await openFiscalYear2025(other.company.id);
    foreignEntryId = await createEntry(other.company.id, other.user.id, '2025-01-15');
  });

  const listFiles = (query: Record<string, string>) =>
    request(app).get('/api/files').query(query).set('Cookie', cookie);

  it('uploads a file straight to an entry and lists the files of that entry', async () => {
    const res = await upload(cookie, { fields: { journalEntryId: januaryEntryId } });
    expect(res.status).toBe(201);
    expect(res.body.data.journalEntryId).toBe(januaryEntryId);
    const unlinked = await uploadedFileId(cookie);

    const ofEntry = await listFiles({ journalEntryId: januaryEntryId });
    expect(ofEntry.status).toBe(200);
    expect(ofEntry.body.data.map((file: { id: string }) => file.id)).toEqual([res.body.data.id]);
    expect(ofEntry.body.meta).toEqual({ total: 1, take: 100, skip: 0 });

    const ofNone = await listFiles({ unlinked: 'true' });
    const idsOfNone = ofNone.body.data.map((file: { id: string }) => file.id);
    expect(idsOfNone).toContain(unlinked);
    expect(idsOfNone).not.toContain(res.body.data.id);

    expect((await listFiles({ journalEntryId: januaryEntryId, unlinked: 'true' })).status).toBe(400);
    expect((await listFiles({ journalEntryId: 'not-an-id' })).status).toBe(400);
  });

  it('links, moves nowhere and unlinks a file with PATCH', async () => {
    const id = await uploadedFileId(cookie);

    const linked = await linkFile(cookie, id, januaryEntryId);
    expect(linked.status).toBe(200);
    expect(linked.body.data.journalEntryId).toBe(januaryEntryId);

    const unknownEntry = await linkFile(cookie, id, randomUUID());
    expect(unknownEntry.status).toBe(404);
    expect(unknownEntry.body.error.message).toBe('Journal entry not found');
    expect((await getFile(cookie, id)).body.data.journalEntryId).toBe(januaryEntryId);

    const unlinked = await linkFile(cookie, id, null);
    expect(unlinked.status).toBe(200);
    expect(unlinked.body.data.journalEntryId).toBeNull();

    const badBody = await request(app)
      .patch(`/api/files/${id}`)
      .set('Cookie', cookie)
      .send({ journalEntryId: januaryEntryId, companyId: other.company.id });
    expect(badBody.status).toBe(400);
  });

  it("treats another company's entry as one that does not exist", async () => {
    const id = await uploadedFileId(cookie);
    const linked = await linkFile(cookie, id, foreignEntryId);
    expect(linked.status).toBe(404);
    expect(linked.body.error.message).toBe('Journal entry not found');

    const before = await objectsOf(companyId);
    const uploaded = await upload(cookie, { fields: { journalEntryId: foreignEntryId } });
    expect(uploaded.status).toBe(404);
    expect(uploaded.body.error.message).toBe('Journal entry not found');
    // The object was stored before the entry was looked up, and taken out
    // again when the file could not be recorded.
    expect(await objectsOf(companyId)).toEqual(before);

    // Nor does the other company's entry show this company any files.
    const ofForeign = await listFiles({ journalEntryId: foreignEntryId });
    expect(ofForeign.status).toBe(200);
    expect(ofForeign.body.data).toEqual([]);
  });

  it('refuses to change the files of an entry in a closed period', async () => {
    const CLOSED = 'Accounting period is closed';
    const before = await objectsOf(companyId);

    const uploaded = await upload(cookie, { fields: { journalEntryId: februaryEntryId } });
    expect(uploaded.status).toBe(409);
    expect(uploaded.body.error.message).toBe(CLOSED);
    expect(await objectsOf(companyId)).toEqual(before);

    const loose = await uploadedFileId(cookie);
    const linked = await linkFile(cookie, loose, februaryEntryId);
    expect(linked.status).toBe(409);
    expect(linked.body.error.message).toBe(CLOSED);

    expect((await linkFile(cookie, februaryFileId, null)).status).toBe(409);
    expect((await linkFile(cookie, februaryFileId, januaryEntryId)).status).toBe(409);
    expect((await deleteFile(cookie, februaryFileId)).status).toBe(409);

    // The file is still there and still the February entry's; reading it is
    // not a change.
    const file = await getFile(cookie, februaryFileId);
    expect(file.body.data.journalEntryId).toBe(februaryEntryId);
    expect((await getContent(cookie, februaryFileId)).status).toBe(200);
  });

  it('keeps the files of a deleted entry, unlinked', async () => {
    const entryId = await createEntry(companyId, userId, '2025-03-05');
    const id = await uploadedFileId(cookie, { fields: { journalEntryId: entryId } });

    const removed = await request(app)
      .delete(`/api/journal-entries/${entryId}`)
      .set('Cookie', cookie);
    expect(removed.status).toBe(204);

    const file = await getFile(cookie, id);
    expect(file.status).toBe(200);
    expect(file.body.data.journalEntryId).toBeNull();
    const content = await getContent(cookie, id).responseType('blob');
    expect(content.status).toBe(200);
    expect(Buffer.compare(content.body as Buffer, PDF)).toBe(0);
  });
});

describe('DELETE /api/files/:id', () => {
  it('deletes the file and its object', async () => {
    const id = await uploadedFileId(cookie);
    const key = companyObjectKey(companyId, id);
    expect(await objectsOf(companyId)).toContain(key);

    expect((await deleteFile(cookie, id)).status).toBe(204);
    expect((await getFile(cookie, id)).status).toBe(404);
    expect(await prisma.storedFile.count({ where: { id } })).toBe(0);
    expect(await objectsOf(companyId)).not.toContain(key);
    // Gone is gone: a second delete finds nothing.
    expect((await deleteFile(cookie, id)).status).toBe(404);
  });

  it('keeps the file when the storage fails to delete its object', async () => {
    silenceErrorLog();
    const id = await uploadedFileId(cookie);
    vi.spyOn(objectStorage, 'delete').mockRejectedValueOnce(new Error('storage is down'));

    expect((await deleteFile(cookie, id)).status).toBe(500);
    expect((await getFile(cookie, id)).status).toBe(200);
    expect((await getContent(cookie, id)).status).toBe(200);

    // Once the storage is back, the same request goes through.
    expect((await deleteFile(cookie, id)).status).toBe(204);
  });
});

describe('when the storage fails', () => {
  it('records no file when the object cannot be stored', async () => {
    silenceErrorLog();
    const fresh = await createTestContext('ADMIN');
    vi.spyOn(objectStorage, 'put').mockRejectedValueOnce(new Error('storage is down'));

    const res = await upload(fresh.cookie);
    expect(res.status).toBe(500);
    expect(res.body.error.message).toBe('Internal server error');
    expect(await prisma.storedFile.count({ where: { companyId: fresh.company.id } })).toBe(0);
  });

  it('answers 500, not 404, when the storage cannot be read', async () => {
    silenceErrorLog();
    const id = await uploadedFileId(cookie);
    vi.spyOn(objectStorage, 'get').mockRejectedValueOnce(new Error('storage is down'));

    const res = await getContent(cookie, id);
    expect(res.status).toBe(500);
    expect((await getContent(cookie, id)).status).toBe(200);
  });
});
