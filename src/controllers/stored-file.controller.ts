import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { StoredFile } from '../generated/prisma/client';
import { fileNotFound, storedFileService } from '../services/stored-file.service';
import { AppError } from '../lib/AppError';
import { idParamsSchema } from '../lib/apiSchemas';
import { attachmentDisposition } from '../lib/contentDisposition';

// A malformed file id is answered like an unknown one, not with a validation
// error: every way of not reaching a file looks the same from outside.
function fileIdOf(req: Request): string {
  const params = idParamsSchema.safeParse(req.params);
  if (!params.success) throw fileNotFound();
  return params.data.id;
}

// The text fields sent along with the file. A form sends an entry left
// unchosen as an empty string.
const uploadFieldsSchema = z.object({
  journalEntryId: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().uuid().optional(),
  ),
});

const updateFileSchema = z.object({ journalEntryId: z.string().uuid().nullable() }).strict();

const listQuerySchema = z
  .object({
    journalEntryId: z.string().uuid().optional(),
    unlinked: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
    take: z.coerce.number().int().min(1).max(500).default(100),
    skip: z.coerce.number().int().min(0).default(0),
  })
  .refine((query) => !(query.journalEntryId && query.unlinked), {
    message: 'Give either journalEntryId or unlinked, not both',
    path: ['unlinked'],
  });

// What a client gets to know about a file. Its storage key is not part of it:
// the key is the server's business alone.
export function serializeFile(file: StoredFile) {
  return {
    id: file.id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    sha256: file.sha256,
    journalEntryId: file.journalEntryId,
    uploadedById: file.uploadedById,
    createdAt: file.createdAt,
  };
}

export const storedFileController = {
  async list(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const query = listQuerySchema.parse(req.query);
    const { files, total } = await storedFileService.list(companyId, query);
    res.json({ data: files.map(serializeFile), meta: { total, take: query.take, skip: query.skip } });
  },

  // Expects uploadSingleFile to have run: the file is in req.file.
  async upload(req: Request, res: Response) {
    const { membership, user } = req.auth!;
    const { journalEntryId } = uploadFieldsSchema.parse(req.body ?? {});
    if (!req.file) {
      throw AppError.badRequest('A file is required, as the multipart form field "file"');
    }
    const file = await storedFileService.upload(membership!.companyId, user.id, {
      content: req.file.buffer,
      originalName: req.file.originalname,
      journalEntryId,
    });
    res.status(201).json({ data: serializeFile(file) });
  },

  async get(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const file = await storedFileService.getById(companyId, fileIdOf(req));
    res.json({ data: serializeFile(file) });
  },

  // The bytes always pass through here; nothing ever points a client at the
  // storage itself.
  async download(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const { file, body, contentLength } = await storedFileService.openContent(
      companyId,
      fileIdOf(req),
    );

    // Always a download under the stored name, never a page the browser opens
    // in place of the app; the type is the one detected from the content at
    // upload.
    res.setHeader('Content-Disposition', attachmentDisposition(file.originalName));
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', contentLength ?? file.size);
    res.setHeader('Cache-Control', 'private, no-store');

    try {
      await pipeline(body, res);
    } catch (err) {
      // pipeline() has torn the response down, so there is nothing left to
      // answer with: the client sees a download that broke off. A client that
      // went away itself is not worth a log line.
      if ((err as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error(`Download of stored file ${file.id} broke off:`, err);
      }
    }
  },

  async update(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    const id = fileIdOf(req);
    const { journalEntryId } = updateFileSchema.parse(req.body);
    const file = await storedFileService.setJournalEntry(companyId, id, journalEntryId);
    res.json({ data: serializeFile(file) });
  },

  async remove(req: Request, res: Response) {
    const companyId = req.auth!.membership!.companyId;
    await storedFileService.remove(companyId, fileIdOf(req));
    res.status(204).send();
  },
};
