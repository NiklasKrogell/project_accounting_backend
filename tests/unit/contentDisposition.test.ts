import { describe, expect, it } from 'vitest';
import { attachmentDisposition } from '../../src/lib/contentDisposition';

describe('attachmentDisposition', () => {
  it('sends a plain name as it is, in both forms', () => {
    expect(attachmentDisposition('kuitti.pdf')).toBe(
      `attachment; filename="kuitti.pdf"; filename*=UTF-8''kuitti.pdf`,
    );
  });

  it('sends letters outside ASCII as UTF-8 in filename* and replaces them in the fallback', () => {
    expect(attachmentDisposition('lasku_päivä.pdf')).toBe(
      `attachment; filename="lasku_p_iv_.pdf"; filename*=UTF-8''lasku_p%C3%A4iv%C3%A4.pdf`,
    );
    expect(attachmentDisposition('🧾 kuitti.pdf')).toContain(
      "filename*=UTF-8''%F0%9F%A7%BE%20kuitti.pdf",
    );
  });

  it('keeps characters that have a meaning in the header out of it', () => {
    expect(attachmentDisposition(`50% "ale" (1)'*\\.pdf`)).toBe(
      `attachment; filename="50_ _ale_ (1)'*_.pdf"; ` +
        `filename*=UTF-8''50%25%20%22ale%22%20%281%29%27%2A%5C.pdf`,
    );
  });

  it('cannot be made to start a new header line', () => {
    const header = attachmentDisposition('a\r\nSet-Cookie: x=1.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain('filename="a__Set-Cookie: x=1.pdf"');
  });

  it('does not fail on a name that is not well-formed', () => {
    expect(attachmentDisposition('a\ud83e.pdf')).toContain("filename*=UTF-8''a%EF%BF%BD.pdf");
  });
});
