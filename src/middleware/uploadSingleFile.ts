import type { RequestHandler } from 'express';
import multer from 'multer';
import { AppError } from '../lib/AppError';
import { MAX_FILE_SIZE_BYTES } from '../lib/fileType';

const MAX_FILE_SIZE_MB = MAX_FILE_SIZE_BYTES / (1024 * 1024);

// Reads a multipart upload of one file (form field "file") into memory as
// req.file, with the form's text fields in req.body. A request that is not
// multipart is passed on untouched. Put it after the auth and role gates: it
// buffers up to MAX_FILE_SIZE_BYTES of whatever it is sent.
function singleFileParser(maxFieldBytes: number): RequestHandler {
  const parse = multer({
    storage: multer.memoryStorage(),
    // File names arrive as UTF-8 ("päivä.pdf"); the parser's default is latin1.
    defParamCharset: 'utf8',
    limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1, fields: 10, fieldSize: maxFieldBytes, parts: 11 },
  }).single('file');

  return (req, res, next) => {
    parse(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(413, `File is too large (the limit is ${MAX_FILE_SIZE_MB} MB)`));
        return;
      }
      // Whatever else stops the parser is a request it can't make sense of: a
      // file in another field, more than one file, a body that breaks off.
      next(AppError.badRequest('Malformed upload: expected one file in the form field "file"'));
    });
  };
}

// For uploads whose text fields are short values (a journal entry's id).
export const uploadSingleFile = singleFileParser(1024);

// For a file sent together with a record as JSON in a text field of its own
// (a new purchase invoice with its PDF).
export const uploadSingleFileWithJson = singleFileParser(16 * 1024);
