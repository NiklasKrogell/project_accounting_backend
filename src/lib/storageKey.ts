// Where a company's files live in the bucket. Every object key is built here
// and nowhere else: companies/{companyId}/{fileId}. Both parts are ids the
// server generated, so a key never contains anything a client sent.

// An id as a key segment: no slashes or dots, so it can't reach outside its
// place in the key.
const KEY_SEGMENT = /^[A-Za-z0-9_-]+$/;

export function companyKeyPrefix(companyId: string): string {
  if (!KEY_SEGMENT.test(companyId)) {
    throw new Error('Company id is not usable in a storage key');
  }
  return `companies/${companyId}/`;
}

export function companyObjectKey(companyId: string, fileId: string): string {
  if (!KEY_SEGMENT.test(fileId)) {
    throw new Error('File id is not usable in a storage key');
  }
  return `${companyKeyPrefix(companyId)}${fileId}`;
}

// Whether `key` is one of the company's own objects. The prefix ends in a
// slash, so a company does not own the keys of another whose id merely starts
// with its own.
export function keyBelongsToCompany(key: string, companyId: string): boolean {
  return key.startsWith(companyKeyPrefix(companyId));
}
