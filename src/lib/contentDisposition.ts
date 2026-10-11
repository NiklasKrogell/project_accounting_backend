// The Content-Disposition of a response to be saved as a file named `fileName`
// (RFC 6266). The name goes in twice: in full as filename*, UTF-8 and
// percent-encoded (RFC 5987), which every current browser prefers, and as a
// plain ASCII filename for anything that doesn't know filename*. Letters like
// "ä" straight in the header would be read by each browser in its own way.
//
// Express's res.attachment() is not used for this: it sends the Latin-1 range
// as raw bytes, without filename*.
export function attachmentDisposition(fileName: string): string {
  // Also out of the quoted fallback: the quote and backslash that would end or
  // escape it, and "%", which some clients take for the start of an escape.
  const asciiName = fileName.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  // encodeURIComponent leaves ' ( ) * as they are; RFC 5987 doesn't allow them
  // bare. toWellFormed: a lone surrogate would make encodeURIComponent throw.
  const encodedName = encodeURIComponent(fileName.toWellFormed()).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}
