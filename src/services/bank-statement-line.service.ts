import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import {
  BankCsvError,
  checkMapping,
  dedupeKeys,
  detectLayout,
  guessMapping,
  ibanInText,
  parseLines,
  readCsv,
  type CsvMapping,
  type ParsedLine,
} from '../lib/bankCsv';
import { acquireStatementLinesLock } from '../lib/companyLock';
import { parseDateOnly } from '../lib/dateOnly';
import { fromCents } from '../lib/money';

// A bank statement's transactions (tiliotteen tapahtumat), imported from the
// bank's CSV export of the account (see lib/bankCsv.ts) and booked one by one:
// a journal entry created with a line's id links the line to it
// (journalEntryService.create), and deleting the entry frees the line again.
//
// - Importing needs the statement's bank account: a transaction is one of that
//   account, and a line already imported to any statement of the same account
//   is skipped as a duplicate.
// - The file itself is not stored: the PDF stays the statement's document.

// More rows than any month of a small company's account has.
export const MAX_LINES_PER_IMPORT = 5000;

export interface CsvUpload {
  content: Buffer;
  originalName: string;
}

const withEntry = {
  journalEntry: { select: { id: true, voucherType: true, voucherNumber: true } },
} satisfies Prisma.BankStatementLineInclude;

export type BankStatementLineWithEntry = Prisma.BankStatementLineGetPayload<{
  include: typeof withEntry;
}>;

async function findStatement(companyId: string, statementId: string) {
  const statement = await prisma.bankStatement.findFirst({
    where: { id: statementId, companyId },
    select: { id: true, bankAccountId: true, bankAccount: { select: { iban: true } } },
  });
  if (!statement) throw AppError.notFound('Bank statement not found');
  return statement;
}

// The file read and its rows turned into transactions, with the columns the
// caller chose or, without a choice, the guessed ones.
function readUpload(upload: CsvUpload, chosen: CsvMapping | undefined, ownIban: string | null) {
  let table;
  try {
    table = readCsv(upload.content);
  } catch (err) {
    if (err instanceof BankCsvError) throw AppError.badRequest(err.message);
    throw err;
  }
  const guessed = guessMapping(table);
  const mapping = chosen ?? guessed;
  const problem = checkMapping(mapping, table.columns.length);
  const { lines, skipped } = problem
    ? { lines: [] as ParsedLine[], skipped: [] }
    : parseLines(table, mapping, { ownIban });
  return { table, mapping, problem, lines, skipped };
}

// The keys among `keys` already imported to a statement of the bank account.
async function importedKeys(
  client: Prisma.TransactionClient,
  companyId: string,
  bankAccountId: string,
  keys: string[],
): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const found = await client.bankStatementLine.findMany({
    where: { companyId, dedupeKey: { in: keys }, bankStatement: { bankAccountId } },
    select: { dedupeKey: true },
  });
  return new Set(found.map((line) => line.dedupeKey));
}

export const bankStatementLineService = {
  // What an import of the file would do, without doing it: the layout found,
  // the columns used, the transactions (each marked when it is a duplicate)
  // and the rows that are no transactions.
  async preview(companyId: string, statementId: string, upload: CsvUpload, chosen?: CsvMapping) {
    const statement = await findStatement(companyId, statementId);
    const ownIban = statement.bankAccount?.iban ?? null;
    const { table, mapping, problem, lines, skipped } = readUpload(upload, chosen, ownIban);
    const keys = dedupeKeys(lines);
    const imported = statement.bankAccountId
      ? await importedKeys(prisma, companyId, statement.bankAccountId, keys)
      : new Set<string>();
    // The account the file says it is of (Nordea names it, in the file's name
    // or before the header), when that is not the statement's.
    const fileIban = table.accountIban ?? ibanInText(upload.originalName);
    return {
      layout: detectLayout(table),
      encoding: table.encoding,
      delimiter: table.delimiter,
      columns: table.columns,
      mapping,
      mappingProblem: problem,
      lines: lines.map((line, i) => ({ ...line, duplicate: imported.has(keys[i]!) })),
      skipped,
      accountMismatch: fileIban && ownIban && fileIban !== ownIban ? fileIban : null,
    };
  },

  // The file's transactions added to the statement, after those already on
  // it, without the ones imported before.
  async import(companyId: string, statementId: string, upload: CsvUpload, chosen?: CsvMapping) {
    const statement = await findStatement(companyId, statementId);
    if (!statement.bankAccountId) {
      throw AppError.badRequest(
        "Choose the bank statement's bank account before importing its transactions",
      );
    }
    const bankAccountId = statement.bankAccountId;
    const { problem, lines, skipped } = readUpload(upload, chosen, statement.bankAccount?.iban ?? null);
    if (problem) throw AppError.badRequest(problem);
    if (lines.length > MAX_LINES_PER_IMPORT) {
      throw AppError.badRequest(`A file can have at most ${MAX_LINES_PER_IMPORT} transactions`);
    }
    const keys = dedupeKeys(lines);

    return prisma.$transaction(async (tx) => {
      await acquireStatementLinesLock(tx, companyId);
      const imported = await importedKeys(tx, companyId, bankAccountId, keys);
      const last = await tx.bankStatementLine.aggregate({
        where: { bankStatementId: statement.id },
        _max: { position: true },
      });
      let position = last._max.position ?? 0;
      const fresh = lines
        .map((line, i) => ({ line, key: keys[i]! }))
        .filter(({ key }) => !imported.has(key));
      await tx.bankStatementLine.createMany({
        data: fresh.map(({ line, key }) => ({
          companyId,
          bankStatementId: statement.id,
          position: (position += 1),
          bookingDate: parseDateOnly(line.bookingDate),
          valueDate: line.valueDate ? parseDateOnly(line.valueDate) : null,
          amount: fromCents(line.amountCents),
          counterparty: line.counterparty,
          counterpartyAccount: line.counterpartyAccount,
          reference: line.reference,
          message: line.message,
          transactionType: line.transactionType,
          archiveId: line.archiveId,
          dedupeKey: key,
        })),
      });
      return {
        imported: fresh.length,
        duplicates: lines.length - fresh.length,
        skipped: skipped.length,
      };
    });
  },

  // In date order, and within a day in the order of the file.
  async list(companyId: string, statementId: string) {
    const statement = await findStatement(companyId, statementId);
    return prisma.bankStatementLine.findMany({
      where: { bankStatementId: statement.id, companyId },
      orderBy: [{ bookingDate: 'asc' }, { position: 'asc' }],
      include: withEntry,
    });
  },

  // A line booked into an entry stays until the entry is deleted.
  async remove(companyId: string, statementId: string, lineId: string): Promise<void> {
    const line = await prisma.bankStatementLine.findFirst({
      where: { id: lineId, bankStatementId: statementId, companyId },
      select: { id: true, journalEntryId: true },
    });
    if (!line) throw AppError.notFound('Bank statement line not found');
    if (line.journalEntryId) {
      throw AppError.conflict('The transaction is booked: delete its journal entry first');
    }
    await prisma.bankStatementLine.delete({ where: { id: line.id } });
  },
};
