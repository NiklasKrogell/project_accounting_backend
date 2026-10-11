import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { detectMimeType, sanitizeFileName } from '../lib/fileType';
import { objectStorage } from '../lib/objectStorage';
import { assertEntryEditable } from './fiscal-guard.service';

// A company's stored files: the StoredFile row is what makes a file exist, the
// object in storage holds its bytes. Rules every function here keeps:
// - The company is the caller's active one (req.auth.membership.companyId),
//   handed in by the controller. A file is never looked up by its id alone.
// - A file that is another company's is answered exactly like one that doesn't
//   exist (fileNotFound), so an id says nothing to someone outside the company.
// - Storage keys are made by the server and stay on it.

export interface UploadFileInput {
  content: Buffer;
  // The name the client gave the file; cleaned up here before it is stored.
  originalName: string;
  journalEntryId?: string | undefined;
}

export interface ListFilesFilter {
  // The files of one journal entry, or (unlinked) those of none; all the
  // company's files when both are left out.
  journalEntryId?: string | undefined;
  unlinked?: boolean | undefined;
  take: number;
  skip: number;
}

// One answer for every way a file can't be reached: there is no such file, it
// belongs to another company, or the id isn't an id at all.
export function fileNotFound(): AppError {
  return AppError.notFound('File not found');
}

// The only way a file is read by id: together with the company it must be in.
async function findCompanyFile(client: Prisma.TransactionClient, companyId: string, id: string) {
  const file = await client.storedFile.findFirst({ where: { id, companyId } });
  if (!file) throw fileNotFound();
  return file;
}

// A file linked to a journal entry is part of that voucher, so the link is
// made and broken only while the entry itself may be changed. The entry must
// be the company's own; another company's is as good as nonexistent.
async function assertEntryFilesChangeable(
  tx: Prisma.TransactionClient,
  companyId: string,
  journalEntryId: string,
): Promise<void> {
  const entry = await tx.journalEntry.findFirst({
    where: { id: journalEntryId, companyId },
    select: { date: true },
  });
  if (!entry) throw AppError.notFound('Journal entry not found');
  await assertEntryEditable(companyId, entry.date, tx);
}

export const storedFileService = {
  // The object is stored first and the row written second: if anything fails in
  // between, what is left is an object nothing points at, never a file that is
  // listed but can't be downloaded. The upload to storage stays outside the
  // transaction, which would otherwise be held open for as long as it takes.
  async upload(companyId: string, userId: string, input: UploadFileInput) {
    if (input.content.length === 0) throw AppError.badRequest('File is empty');
    const mimeType = detectMimeType(input.content);
    if (!mimeType) {
      throw new AppError(415, 'Unsupported file type: a file must be a PDF or a JPEG, PNG or WebP image');
    }

    const id = randomUUID();
    const storageKey = await objectStorage.put(companyId, id, input.content, mimeType);
    try {
      return await prisma.$transaction(async (tx) => {
        if (input.journalEntryId) {
          await assertEntryFilesChangeable(tx, companyId, input.journalEntryId);
        }
        return tx.storedFile.create({
          data: {
            id,
            companyId,
            storageKey,
            originalName: sanitizeFileName(input.originalName),
            mimeType,
            size: input.content.length,
            sha256: createHash('sha256').update(input.content).digest('hex'),
            uploadedById: userId,
            journalEntryId: input.journalEntryId ?? null,
          },
        });
      });
    } catch (err) {
      await objectStorage.delete(companyId, storageKey).catch((cleanupErr: unknown) => {
        console.error(`Could not remove the object of a failed upload (${storageKey}):`, cleanupErr);
      });
      throw err;
    }
  },

  async list(companyId: string, filter: ListFilesFilter) {
    const where: Prisma.StoredFileWhereInput = { companyId };
    if (filter.journalEntryId) where.journalEntryId = filter.journalEntryId;
    else if (filter.unlinked) where.journalEntryId = null;

    const [files, total] = await prisma.$transaction([
      prisma.storedFile.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: filter.take,
        skip: filter.skip,
      }),
      prisma.storedFile.count({ where }),
    ]);
    return { files, total };
  },

  async getById(companyId: string, id: string) {
    return findCompanyFile(prisma, companyId, id);
  },

  // The file with its bytes as a stream, for a download.
  async openContent(companyId: string, id: string) {
    const file = await findCompanyFile(prisma, companyId, id);
    const object = await objectStorage.get(companyId, file.storageKey);
    if (!object) {
      // The row promises bytes that aren't there. That needs looking into, but
      // to the caller the file simply isn't.
      console.error(`Stored file ${file.id} has no object in storage (${file.storageKey})`);
      throw fileNotFound();
    }
    return { file, body: object.body, contentLength: object.contentLength };
  },

  // Links the file to a journal entry, moves it to another or (null) unlinks
  // it. Both the entry it leaves and the one it joins change, so both must be
  // editable.
  async setJournalEntry(companyId: string, id: string, journalEntryId: string | null) {
    return prisma.$transaction(async (tx) => {
      const file = await findCompanyFile(tx, companyId, id);
      if (file.journalEntryId === journalEntryId) return file;
      if (file.journalEntryId) {
        await assertEntryFilesChangeable(tx, companyId, file.journalEntryId);
      }
      if (journalEntryId) {
        await assertEntryFilesChangeable(tx, companyId, journalEntryId);
      }
      return tx.storedFile.update({ where: { id: file.id }, data: { journalEntryId } });
    });
  },

  // The object is deleted as the transaction's last step, so that a storage
  // failure rolls the row back: a file never disappears from the company's
  // list while its bytes are still stored. (objectStorage.delete gives up well
  // within the transaction's time limit.)
  async remove(companyId: string, id: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const file = await findCompanyFile(tx, companyId, id);
      if (file.journalEntryId) {
        await assertEntryFilesChangeable(tx, companyId, file.journalEntryId);
      }
      await tx.storedFile.delete({ where: { id: file.id } });
      await objectStorage.delete(companyId, file.storageKey);
    });
  },
};
