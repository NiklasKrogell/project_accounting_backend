// What a company may upload, and how an upload's type and name are decided.
// The type is read from the content itself: a file is what its first bytes say
// it is, whatever name or Content-Type the client sent with it.

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

// The types a stored file can be: the documents of a voucher, in formats every
// browser can show. To allow another type, add it here and its signature to
// detectMimeType.
export const STORABLE_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type StorableMimeType = (typeof STORABLE_MIME_TYPES)[number];

function hasBytesAt(content: Buffer, offset: number, bytes: readonly number[]): boolean {
  return (
    content.length >= offset + bytes.length &&
    bytes.every((byte, i) => content[offset + i] === byte)
  );
}

const ascii = (text: string) => [...Buffer.from(text, 'ascii')];

const PDF = ascii('%PDF-');
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = ascii('RIFF');
const WEBP = ascii('WEBP');

// The type the content is, or null when it is none of the storable ones.
export function detectMimeType(content: Buffer): StorableMimeType | null {
  if (hasBytesAt(content, 0, PDF)) return 'application/pdf';
  if (hasBytesAt(content, 0, JPEG)) return 'image/jpeg';
  if (hasBytesAt(content, 0, PNG)) return 'image/png';
  // A RIFF container holds other formats too (WAV, AVI); the form type at
  // offset 8 says which.
  if (hasBytesAt(content, 0, RIFF) && hasBytesAt(content, 8, WEBP)) return 'image/webp';
  return null;
}

const MAX_FILE_NAME_LENGTH = 255;
const MAX_KEPT_EXTENSION_LENGTH = 16;

// Control characters, and the Unicode marks that change the direction text is
// shown in: with a right-to-left override, "lasku‮fdp.exe" reads as
// "laskuexe.pdf".
const UNSAFE_NAME_CHARACTERS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

// The name a file is stored and later downloaded under: the client's name for
// it without any directory part or unsafe characters, composed (NFC) so that
// "ä" is one character however the client's file system wrote it, and cut to a
// length that fits everywhere. The name never decides the file's type.
export function sanitizeFileName(name: string): string {
  const baseName = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const cleaned = baseName.normalize('NFC').replace(UNSAFE_NAME_CHARACTERS, '').trim();
  if (cleaned === '' || /^\.+$/.test(cleaned)) return 'file';

  // Counted in code points, so that cutting never splits a character.
  const characters = [...cleaned];
  if (characters.length <= MAX_FILE_NAME_LENGTH) return cleaned;
  const dot = characters.lastIndexOf('.');
  const extension =
    dot > 0 && characters.length - dot <= MAX_KEPT_EXTENSION_LENGTH ? characters.slice(dot) : [];
  return [...characters.slice(0, MAX_FILE_NAME_LENGTH - extension.length), ...extension].join('');
}
