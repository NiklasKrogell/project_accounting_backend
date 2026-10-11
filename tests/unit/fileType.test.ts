import { describe, expect, it } from 'vitest';
import { detectMimeType, sanitizeFileName } from '../../src/lib/fileType';

const bytes = (...values: number[]) => Buffer.from(values);
const text = (value: string) => Buffer.from(value, 'latin1');

describe('detectMimeType', () => {
  it('recognizes the storable types by their first bytes', () => {
    expect(detectMimeType(text('%PDF-1.7\n1 0 obj'))).toBe('application/pdf');
    expect(detectMimeType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe('image/jpeg');
    expect(detectMimeType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe(
      'image/png',
    );
    expect(detectMimeType(text('RIFF\x24\x00\x00\x00WEBPVP8 '))).toBe('image/webp');
  });

  it('refuses everything else', () => {
    expect(detectMimeType(Buffer.alloc(0))).toBeNull();
    expect(detectMimeType(text('<!doctype html><script>alert(1)</script>'))).toBeNull();
    expect(detectMimeType(text('MZ\x90\x00\x03'))).toBeNull(); // Windows executable
    expect(detectMimeType(text('PK\x03\x04'))).toBeNull(); // zip, so also docx and xlsx
    expect(detectMimeType(text('Tili;Summa\n1900;12,50\n'))).toBeNull();
    // Another format in the same RIFF container as WebP.
    expect(detectMimeType(text('RIFF\x24\x00\x00\x00WAVEfmt '))).toBeNull();
  });

  it('needs the whole signature, at the start', () => {
    expect(detectMimeType(text('%PDF'))).toBeNull();
    expect(detectMimeType(bytes(0xff, 0xd8))).toBeNull();
    expect(detectMimeType(text('RIFF\x24\x00\x00\x00WEB'))).toBeNull();
    expect(detectMimeType(text(' %PDF-1.7'))).toBeNull();
  });
});

describe('sanitizeFileName', () => {
  it('keeps an ordinary name as it is', () => {
    expect(sanitizeFileName('lasku_päivä 2025.pdf')).toBe('lasku_päivä 2025.pdf');
    expect(sanitizeFileName('.kuitti')).toBe('.kuitti');
  });

  it('drops any directory part', () => {
    expect(sanitizeFileName('C:\\Users\\Matti\\kuitti.pdf')).toBe('kuitti.pdf');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('kansio/ali\\kuitti.png')).toBe('kuitti.png');
  });

  it('drops control characters and direction marks', () => {
    expect(sanitizeFileName('lasku\r\n.pdf')).toBe('lasku.pdf');
    expect(sanitizeFileName('lasku\u0000.pdf')).toBe('lasku.pdf');
    // Shown as "laskuexe.pdf" with the right-to-left override in place.
    expect(sanitizeFileName('lasku\u202Efdp.exe')).toBe('laskufdp.exe');
  });

  it('composes characters a file system wrote in two parts', () => {
    const decomposed = 'pa\u0308iva\u0308.pdf';
    expect(sanitizeFileName(decomposed)).toBe('päivä.pdf');
    expect(sanitizeFileName(decomposed)).toHaveLength(9);
  });

  it('falls back to a name when nothing is left', () => {
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('   ')).toBe('file');
    expect(sanitizeFileName('..')).toBe('file');
    expect(sanitizeFileName('kansio/')).toBe('file');
  });

  it('cuts a long name but keeps its extension', () => {
    const cut = sanitizeFileName(`${'ä'.repeat(300)}.pdf`);
    expect([...cut]).toHaveLength(255);
    expect(cut.endsWith('.pdf')).toBe(true);
    // Nothing that looks like an extension to keep: just cut.
    expect([...sanitizeFileName('a'.repeat(300))]).toHaveLength(255);
    // Characters outside the basic plane are not split in half.
    expect(sanitizeFileName('🧾'.repeat(300))).toBe('🧾'.repeat(255));
  });
});
