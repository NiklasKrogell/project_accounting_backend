// Reading a bank's CSV export of an account's transactions (tilitapahtumat).
// Deliberately DB-free, like lib/vat.ts: the service decides what is stored.
//
// Finnish banks share no CSV standard and don't publish their layouts, and they
// change them now and then. What they do share is the vocabulary of the column
// names (Kirjauspäivä, Määrä, Saaja/Maksaja, Viite, Viesti, Arkistointitunnus…),
// the decimal comma and `;` or tab as separator. So a column is recognised by
// its name, with its values as the fallback, and the result is only a guess:
// the caller shows it and lets the user correct it (a CsvMapping).
//
// Layouts known from real files (see tests/fixtures/bank-csv/):
// - OP: `Kirjauspäivä;Arvopäivä;Määrä EUROA;Laji;Selitys;Saaja/Maksaja;Saajan
//   tilinumero ja pankin BIC;Viite;Viesti;Arkistointitunnus` and variants,
//   dd.mm.yyyy dates, only the header row ending in `;`.
// - Nordea, current netbank: UTF-8 with BOM, `Kirjauspäivä;Määrä;Maksaja;
//   Maksunsaaja;Nimi;Otsikko;Viesti;Viitenumero;Saldo;Valuutta;`, yyyy/mm/dd
//   dates, newest first. Maksaja and Maksunsaaja are the two accounts, one of
//   them the account's own; a pending card payment has "Varaus" for a date.
// - Nordea, old netbank: tab-separated, a `Tilinumero⇥FI…` line before the
//   header `Kirjauspäivä⇥Arvopäivä⇥Maksupäivä⇥Määrä⇥Saaja/Maksaja⇥Tilinumero⇥
//   BIC⇥Tapahtuma⇥Viite⇥Maksajan viite⇥Viesti⇥Kortinnumero⇥Kuitti`.

import { createHash } from 'node:crypto';
import { parseDateOnly } from './dateOnly';
import { isValidIban, normalizeIban } from './iban';

export type CsvEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';
export type CsvDelimiter = ';' | '\t' | ',';

// What a column can be. An amount comes either as one signed column or as a
// pair: money in and money out.
export const CSV_FIELDS = [
  'bookingDate',
  'valueDate',
  'amount',
  'amountIn',
  'amountOut',
  'counterparty',
  'counterpartyAccount',
  'reference',
  'message',
  'transactionType',
  'archiveId',
] as const;
export type CsvField = (typeof CSV_FIELDS)[number];

// The columns (by index) each field is read from. A date or an amount is read
// from its first column. Of several text columns the first non-empty value
// counts, except for the message, which joins them, and for the counterparty
// account, which skips the account's own IBAN (Nordea lists both sides).
export type CsvMapping = Partial<Record<CsvField, number[]>>;

export type CsvLayout = 'op' | 'nordea' | 'nordea-classic';

export interface CsvTable {
  encoding: CsvEncoding;
  delimiter: CsvDelimiter;
  // The header's column names; made-up ones when the file has no header.
  columns: string[];
  rows: Array<{ lineNumber: number; cells: string[] }>;
  // An IBAN found in the lines before the header (Nordea's old layout names
  // the account there).
  accountIban: string | null;
}

export interface ParsedLine {
  // 1-based, as a text editor counts the file's lines.
  lineNumber: number;
  bookingDate: string; // YYYY-MM-DD
  valueDate: string | null;
  amountCents: number; // + in, - out
  counterparty: string;
  counterpartyAccount: string;
  reference: string;
  message: string;
  transactionType: string;
  archiveId: string | null;
}

export type SkipReason = 'pending' | 'no-date' | 'no-amount' | 'currency';

export interface SkippedLine {
  lineNumber: number;
  reason: SkipReason;
}

export class BankCsvError extends Error {}

// ---------------------------------------------------------------------------
// Bytes to rows

export function decodeCsv(content: Buffer): { text: string; encoding: CsvEncoding } {
  if (content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(content.subarray(3)), encoding: 'utf-8' };
  }
  if (content[0] === 0xff && content[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(content.subarray(2)), encoding: 'utf-16le' };
  }
  if (content[0] === 0xfe && content[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(content.subarray(2)), encoding: 'utf-16be' };
  }
  // Without a byte order mark: UTF-8 if the bytes are valid UTF-8 (which
  // Latin-1 text with an "ä" in it never is), else the Windows code page the
  // older exports are in.
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(content), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(content), encoding: 'windows-1252' };
  }
}

// The separator is the one of `;`, tab and `,` the first line has most of,
// outside quotes; `;` wins a tie, being what Finnish banks use.
function detectDelimiter(text: string): CsvDelimiter {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  const counts: Record<CsvDelimiter, number> = { ';': 0, '\t': 0, ',': 0 };
  let quoted = false;
  for (const char of firstLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === ';' || char === '\t' || char === ',')) counts[char] += 1;
  }
  const order: CsvDelimiter[] = [';', '\t', ','];
  return order.reduce((best, d) => (counts[d] > counts[best] ? d : best), ';');
}

// RFC 4180: a field in double quotes may hold the separator, line breaks and
// doubled quotes. Blank lines are dropped; trailing empty cells are kept here
// and dealt with by the caller.
function splitRows(text: string, delimiter: CsvDelimiter): Array<{ lineNumber: number; cells: string[] }> {
  const rows: Array<{ lineNumber: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowStart = 1;
  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== '')) rows.push({ lineNumber: rowStart, cells });
    cells = [];
    cell = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === '\n') line += 1;
        cell += char;
      }
    } else if (char === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (char === delimiter) {
      cells.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
      line += 1;
      rowStart = line;
    } else {
      cell += char;
    }
  }
  if (cell !== '' || cells.length > 0) endRow();
  return rows;
}

// ---------------------------------------------------------------------------
// Column names

// A header cell as compared below: lower case, no quotes, single spaces.
function normalizeHeader(name: string): string {
  return name.replace(/"/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// The names each field goes by, best first. A name matches when the header
// equals it or starts with it followed by a space ("Määrä EUROA").
const FIELD_NAMES: Record<CsvField, string[]> = {
  bookingDate: [
    'kirjauspäivä', 'kirjauspvm', 'kirjattu', 'tapahtumapäivä', 'päivämäärä', 'pvm',
    'bokföringsdag', 'bokföringsdatum', 'datum', 'booking date', 'date',
  ],
  valueDate: ['arvopäivä', 'valuuttapäivä', 'valutadag', 'value date'],
  amount: ['määrä', 'summa', 'rahamäärä', 'belopp', 'amount'],
  amountIn: ['pano', 'panot', 'talletus', 'insättning', 'deposit', 'money in'],
  amountOut: ['otto', 'otot', 'nosto', 'uttag', 'withdrawal', 'money out'],
  counterparty: [
    'saaja/maksaja', 'maksaja/saaja', 'saaja / maksaja', 'nimi', 'vastapuoli', 'saajan nimi',
    'maksajan nimi', 'otsikko', 'mottagare/betalare', 'betalare/mottagare', 'namn',
    'counterparty', 'name', 'payee', 'payer',
  ],
  counterpartyAccount: [
    'saajan tilinumero ja pankin bic', 'saajan tilinumero', 'maksunsaaja', 'maksaja', 'tilinumero',
    'vastatili', 'kontonummer', 'iban', 'account',
  ],
  reference: ['viite', 'viitenumero', 'viitteet', 'referens', 'reference'],
  message: ['viesti', 'selite', 'kuvaus', 'maksajan viite', 'lisätiedot', 'meddelande', 'message', 'description'],
  transactionType: ['selitys', 'tapahtuma', 'tapahtumalaji', 'laji', 'tapahtumalajikoodi', 'typ', 'type'],
  archiveId: [
    'arkistointitunnus', 'arkistotunnus', 'arkistointiviite', 'arkistoviite', 'arkiveringskod',
    'archive id',
  ],
};

// Columns that are read for checks only, never mapped.
const CURRENCY_NAMES = ['valuutta', 'valuta', 'currency'];

function nameRank(header: string, names: string[]): number {
  const h = normalizeHeader(header);
  return names.findIndex((name) => h === name || h.startsWith(`${name} `));
}

const isKnownHeader = (cell: string) =>
  Object.values(FIELD_NAMES).some((names) => nameRank(cell, names) >= 0) ||
  nameRank(cell, CURRENCY_NAMES) >= 0;

// ---------------------------------------------------------------------------
// Values

const DATE_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => [string, string, string]]> = [
  [/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, (m) => [m[3]!, m[2]!, m[1]!]],
  [/^(\d{4})-(\d{2})-(\d{2})$/, (m) => [m[1]!, m[2]!, m[3]!]],
  [/^(\d{4})\/(\d{2})\/(\d{2})$/, (m) => [m[1]!, m[2]!, m[3]!]],
  [/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/, (m) => [`20${m[3]!}`, m[2]!, m[1]!]],
];

// A date as YYYY-MM-DD, or null when the text is none of the forms banks use.
export function parseCsvDate(value: string): string | null {
  const text = value.trim();
  for (const [pattern, parts] of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const [year, month, day] = parts(match);
    const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    try {
      parseDateOnly(iso);
      return iso;
    } catch {
      return null;
    }
  }
  return null;
}

// An amount in cents, or null. Takes a leading or trailing sign (also the
// minus sign U+2212), a decimal comma or point, and spaces, non-breaking
// spaces, apostrophes or the other separator as thousands separators:
// -1 234,56  +12,50  12,50-  1.234,56  12.50  "-50,00 €".
export function parseCsvAmount(value: string): number | null {
  let text = value.replace(/[\s  ']/g, '').replace(/−/g, '-').replace(/€|EUR$/i, '');
  if (text === '') return null;
  let negative = false;
  if (/^[+-]/.test(text)) {
    negative = text.startsWith('-');
    text = text.slice(1);
  } else if (/[+-]$/.test(text)) {
    negative = text.endsWith('-');
    text = text.slice(0, -1);
  }
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  const decimalAt = Math.max(lastComma, lastDot);
  let whole = text;
  let fraction = '';
  // A separator is the decimal one when it is the last one and 1-2 digits
  // follow it; any other is a thousands separator.
  if (decimalAt >= 0 && /^\d{1,2}$/.test(text.slice(decimalAt + 1))) {
    whole = text.slice(0, decimalAt);
    fraction = text.slice(decimalAt + 1);
  }
  whole = whole.replace(/[.,]/g, '');
  if (!/^\d+$/.test(whole) || (fraction !== '' && !/^\d{1,2}$/.test(fraction))) return null;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

const BIC_AT_END = /\s+[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;

// An account as found in a cell: an IBAN without spaces (OP's column also
// holds the bank's BIC after it), or the text as it is when it is no IBAN.
export function cleanAccount(value: string): string {
  const text = value.trim();
  const iban = normalizeIban(text.replace(BIC_AT_END, ''));
  return isValidIban(iban) ? iban : text;
}

// An IBAN in a file's name: Nordea names its export after the account
// ("Käyttötili FI60 1519 3500 8305 55 - 2026-10-17 14.28.53.csv").
export function ibanInText(text: string): string | null {
  const candidates = text.toUpperCase().match(/[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?/g) ?? [];
  for (const candidate of candidates) {
    const iban = normalizeIban(candidate);
    if (isValidIban(iban)) return iban;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading a file

export function readCsv(content: Buffer): CsvTable {
  if (content.length === 0) throw new BankCsvError('The file is empty');
  const { text, encoding } = decodeCsv(content);
  // A PDF or any other binary file: text has no NUL characters (UTF-16 does
  // have zero bytes, but they are gone once decoded).
  if (text.startsWith('%PDF-') || text.includes('\u0000')) {
    throw new BankCsvError('The file is not a CSV file');
  }
  const delimiter = detectDelimiter(text);
  const rows = splitRows(text, delimiter);
  if (rows.length === 0) throw new BankCsvError('The file has no rows');

  // The header is the first row, within the first ten, with two known column
  // names; a file whose first row already holds a date has none.
  let headerIndex = rows.slice(0, 10).findIndex(
    (row) => row.cells.filter((cell) => isKnownHeader(cell)).length >= 2,
  );
  let columns: string[];
  if (headerIndex >= 0) {
    columns = rows[headerIndex]!.cells.map((cell) => cell.trim());
  } else {
    const first = rows[0]!.cells;
    if (first.some((cell) => parseCsvDate(cell) !== null)) {
      headerIndex = -1;
      columns = first.map((_, i) => `#${i + 1}`);
    } else {
      headerIndex = 0;
      columns = first.map((cell, i) => cell.trim() || `#${i + 1}`);
    }
  }

  const before = headerIndex > 0 ? rows.slice(0, headerIndex) : [];
  const accountIban =
    before.flatMap((row) => row.cells).map((cell) => cleanAccount(cell)).find((cell) => isValidIban(cell)) ??
    null;

  // OP ends only its header with a separator, Nordea every row: an unnamed
  // last column is dropped.
  while (columns.length > 0 && columns[columns.length - 1] === '') columns.pop();
  const width = Math.max(columns.length, 1);

  return {
    encoding,
    delimiter,
    columns,
    rows: rows.slice(headerIndex + 1).map((row) => ({
      lineNumber: row.lineNumber,
      cells: Array.from({ length: width }, (_, i) => (row.cells[i] ?? '').trim()),
    })),
    accountIban,
  };
}

// ---------------------------------------------------------------------------
// Guessing the columns

const isIbanLike = (value: string) => isValidIban(cleanAccount(value));

function shareOf(table: CsvTable, column: number, test: (value: string) => boolean): number {
  const values = table.rows.map((row) => row.cells[column] ?? '').filter((v) => v !== '');
  if (values.length === 0) return 0;
  return values.filter(test).length / values.length;
}

export function detectLayout(table: CsvTable): CsvLayout | null {
  const names = table.columns.map(normalizeHeader);
  const has = (name: string) => names.includes(name);
  if (has('maksaja') && has('maksunsaaja') && has('otsikko')) return 'nordea';
  if (has('maksupäivä') && has('kortinnumero') && has('maksajan viite')) return 'nordea-classic';
  if (
    names[0] === 'kirjauspäivä' &&
    names[1] === 'arvopäivä' &&
    (names[2] ?? '').startsWith('määrä') &&
    names.some((n) => n === 'arkistointitunnus' || n === 'arkistotunnus')
  ) {
    return 'op';
  }
  return null;
}

export function guessMapping(table: CsvTable): CsvMapping {
  const mapping: CsvMapping = {};
  const taken = new Set<number>();
  const take = (field: CsvField, columns: number[]) => {
    const free = columns.filter((c) => !taken.has(c));
    if (free.length === 0) return;
    mapping[field] = free;
    free.forEach((c) => taken.add(c));
  };

  // By name: each field takes the columns that go by one of its names, best
  // name first. A "Maksaja"-like column is an account when it holds IBANs and
  // a counterparty otherwise.
  const byName = (field: CsvField, test?: (column: number) => boolean) =>
    table.columns
      .map((header, column) => ({ column, rank: nameRank(header, FIELD_NAMES[field]) }))
      .filter(({ column, rank }) => rank >= 0 && !taken.has(column) && (!test || test(column)))
      .sort((a, b) => a.rank - b.rank)
      .map(({ column }) => column);
  const holdsIbans = (column: number) => shareOf(table, column, isIbanLike) >= 0.5;

  const first = (columns: number[]) => columns.slice(0, 1);
  take('bookingDate', first(byName('bookingDate')));
  take('valueDate', first(byName('valueDate')));
  take('amount', first(byName('amount')));
  if (!mapping.amount) {
    take('amountIn', first(byName('amountIn')));
    take('amountOut', first(byName('amountOut')));
  }
  take('archiveId', first(byName('archiveId')));
  take('reference', first(byName('reference')));
  take('counterpartyAccount', byName('counterpartyAccount', holdsIbans));
  take('counterparty', byName('counterparty', (c) => !holdsIbans(c)));
  // OP: "Selitys" (TILISIIRTO) over "Laji" (a number code).
  take('transactionType', first(byName('transactionType', (c) => shareOf(table, c, (v) => /^\d+$/.test(v)) < 0.5)));
  take('message', byName('message'));
  // An IBAN column the names didn't catch ("Tilinumero" in Nordea's old layout
  // is caught; this is for others).
  if (!mapping.counterpartyAccount) {
    take(
      'counterpartyAccount',
      table.columns.map((_, c) => c).filter((c) => !taken.has(c) && holdsIbans(c)).slice(0, 1),
    );
  }

  // By value, for a file whose names said nothing: the date and the amount
  // are what can't be done without.
  const free = () => table.columns.map((_, c) => c).filter((c) => !taken.has(c));
  if (!mapping.bookingDate) {
    take('bookingDate', free().filter((c) => shareOf(table, c, (v) => parseCsvDate(v) !== null) >= 0.8).slice(0, 1));
  }
  if (!mapping.amount && !mapping.amountIn && !mapping.amountOut) {
    take(
      'amount',
      free().filter((c) => shareOf(table, c, (v) => parseCsvAmount(v) !== null && /[.,]\d{2}\D*$/.test(v)) >= 0.8).slice(0, 1),
    );
  }
  return mapping;
}

// The mapping is usable: a date, an amount, and only columns the file has.
export function checkMapping(mapping: CsvMapping, columnCount: number): string | null {
  for (const columns of Object.values(mapping)) {
    if (columns?.some((c) => c >= columnCount)) return 'The mapping names a column the file does not have';
  }
  if (!mapping.bookingDate?.length) return 'Choose the column of the booking date';
  if (!mapping.amount?.length && !mapping.amountIn?.length && !mapping.amountOut?.length) {
    return 'Choose the column of the amount';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rows to transactions

const PENDING = /^(varaus|katevaraus|reserved|reservation|reservering|pending)$/i;

export function parseLines(
  table: CsvTable,
  mapping: CsvMapping,
  options: { ownIban?: string | null } = {},
): { lines: ParsedLine[]; skipped: SkippedLine[] } {
  const own = options.ownIban ? normalizeIban(options.ownIban) : null;
  const currencyColumn = table.columns.findIndex((name) => nameRank(name, CURRENCY_NAMES) >= 0);
  const lines: ParsedLine[] = [];
  const skipped: SkippedLine[] = [];

  for (const { lineNumber, cells } of table.rows) {
    const cell = (column: number | undefined) => (column === undefined ? '' : (cells[column] ?? ''));
    const values = (field: CsvField) => (mapping[field] ?? []).map((c) => cell(c)).filter((v) => v !== '');
    const firstValue = (field: CsvField) => values(field)[0] ?? '';

    const dateText = cell(mapping.bookingDate?.[0]);
    const bookingDate = parseCsvDate(dateText);
    if (!bookingDate) {
      skipped.push({ lineNumber, reason: PENDING.test(dateText.trim()) ? 'pending' : 'no-date' });
      continue;
    }

    let amountCents: number | null;
    if (mapping.amount?.length) {
      amountCents = parseCsvAmount(cell(mapping.amount[0]));
    } else {
      const moneyIn = parseCsvAmount(cell(mapping.amountIn?.[0]));
      const moneyOut = parseCsvAmount(cell(mapping.amountOut?.[0]));
      amountCents = moneyIn !== null && moneyIn !== 0 ? Math.abs(moneyIn) : moneyOut !== null ? -Math.abs(moneyOut) : moneyIn;
    }
    if (amountCents === null) {
      skipped.push({ lineNumber, reason: 'no-amount' });
      continue;
    }

    const currency = currencyColumn >= 0 ? cell(currencyColumn).toUpperCase() : '';
    if (currency !== '' && currency !== 'EUR') {
      skipped.push({ lineNumber, reason: 'currency' });
      continue;
    }

    const accounts = values('counterpartyAccount').map(cleanAccount).filter((account) => account !== own);
    const archiveId = firstValue('archiveId');
    lines.push({
      lineNumber,
      bookingDate,
      valueDate: parseCsvDate(cell(mapping.valueDate?.[0])),
      amountCents,
      counterparty: firstValue('counterparty'),
      counterpartyAccount: accounts[0] ?? '',
      reference: firstValue('reference').replace(/\s+/g, ''),
      message: [...new Set(values('message'))].join(' '),
      transactionType: firstValue('transactionType'),
      archiveId: archiveId === '' ? null : archiveId,
    });
  }

  // Oldest first, whichever way the bank lists them (Nordea: newest first).
  const firstDate = lines[0]?.bookingDate;
  const lastDate = lines[lines.length - 1]?.bookingDate;
  if (firstDate && lastDate && firstDate > lastDate) lines.reverse();
  return { lines, skipped };
}

// What tells one transaction from another across imports: the bank's archive
// ID when the file has one, otherwise the transaction's details. Two identical
// card payments on the same day are both real, so identical details are
// numbered in the order they come; the same file imported again gives the same
// keys.
export function dedupeKeys(lines: ParsedLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    if (line.archiveId) return `a:${line.archiveId}`;
    const digest = createHash('sha256')
      .update(
        JSON.stringify([
          line.bookingDate,
          line.amountCents,
          line.counterparty,
          line.counterpartyAccount,
          line.reference,
          line.message,
        ]),
      )
      .digest('hex')
      .slice(0, 32);
    const count = (seen.get(digest) ?? 0) + 1;
    seen.set(digest, count);
    return `h:${digest}:${count}`;
  });
}
