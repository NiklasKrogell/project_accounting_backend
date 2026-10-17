import { describe, expect, it } from 'vitest';
import {
  checkMapping,
  cleanAccount,
  dedupeKeys,
  detectLayout,
  guessMapping,
  ibanInText,
  parseCsvAmount,
  parseCsvDate,
  parseLines,
  readCsv,
  type ParsedLine,
} from '../../src/lib/bankCsv';

// The files below are made up, in the layouts of real exports: OP's from the
// known header variants, Nordea's current one from the structure of a real
// export (UTF-8 with BOM, `;`, newest first, "Varaus" for a pending payment,
// the account's own IBAN on one side), Nordea's old one from a published
// sample. The IBANs are made-up ones with valid check digits.
const OWN = 'FI1410093000123458';
const OWN_SPACED = 'FI14 1009 3000 1234 58';

const utf8Bom = (text: string) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);
// Windows-1252 and Latin-1 agree on every character used here.
const windows1252 = (text: string) => Buffer.from(text, 'latin1');

const NORDEA = utf8Bom(
  [
    'Kirjauspäivä;Määrä;Maksaja;Maksunsaaja;Nimi;Otsikko;Viesti;Viitenumero;Saldo;Valuutta;',
    `Varaus;-23,90;${OWN_SPACED};;Kahvila Esimerkki;Kahvila Esimerkki;;;;EUR;`,
    `2026/10/15;-45,20;${OWN_SPACED};;Sähkö Oy;Sähkö Oy;;00000000000000012345;854,10;EUR;`,
    `2026/10/12;-120,00;${OWN_SPACED};FI5940008000123456;Vuokranantaja Oy;Vuokranantaja Oy;Vuokra lokakuu;;899,30;EUR;`,
    `2026/10/10;-9,99;${OWN_SPACED};;;Korttiosto;;;1019,30;EUR;`,
    `2026/10/05;1500,00;;${OWN_SPACED};Asiakas Oy;Asiakas Oy;Lasku 1001;;1029,29;EUR;`,
    `2026/10/03;-4,50;${OWN_SPACED};;Kioski;Kioski;;;-470,71;EUR;`,
    `2026/10/03;-4,50;${OWN_SPACED};;Kioski;Kioski;;;-466,21;EUR;`,
    `2026/10/01;-30,00;${OWN_SPACED};FI47 5790 0000 0111 11;Kerho ry;Jäsenmaksu;;;-461,71;EUR;`,
    '',
  ].join('\n'),
);

const OP = windows1252(
  [
    'Kirjauspäivä;Arvopäivä;Määrä EUROA;Laji;Selitys;Saaja/Maksaja;Saajan tilinumero ja pankin BIC;Viite;Viesti;Arkistointitunnus;',
    '04.03.2026;04.03.2026;-50,00;106;TILISIIRTO;Vuokranantaja Oy;FI59 4000 8000 1234 56 OKOYFIHH;;Vuokra maaliskuu;20260304/5ABCDE/012345',
    '05.03.2026;05.03.2026;+1 250,00;710;PANO;Asiakas Oy;FI47 5790 0000 0111 11 NDEAFIHH;;Lasku 1002;20260305/5ABCDE/012346',
    '06.03.2026;06.03.2026;-12,34;162;KORTTIOSTO;Kauppa Ä&Ö;;;;20260306/5ABCDE/012347',
    '\r',
  ].join('\r\n'),
);

// Tab-separated, the account named before the header.
const NORDEA_CLASSIC = windows1252(
  [
    `Tilinumero\t${OWN_SPACED}`,
    '',
    'Kirjauspäivä\tArvopäivä\tMaksupäivä\tMäärä\tSaaja/Maksaja\tTilinumero\tBIC\tTapahtuma\tViite\tMaksajan viite\tViesti\tKortinnumero\tKuitti\t',
    '15.01.2015\t15.01.2015\t15.01.2015\t1700,12\tTyönantaja Oy\t\t\tPano\t\t\tPalkka\t\t\t',
    '18.01.2015\t18.01.2015\t18.01.2015\t-12,21\tRuokakauppa\t\t\tKorttiosto\t987654321098\t\tHELSINKI\t1231231231231231\t\t',
    '19.01.2015\t19.01.2015\t19.01.2015\t-20,00\tYhdistys ry\tFI59 4000 8000 1234 56\tOKOYFIHH\tItsepalvelu\t4564564564\t\t\t\t\t',
  ].join('\r\n'),
);

const linesOf = (content: Buffer, ownIban: string | null = OWN) => {
  const table = readCsv(content);
  return parseLines(table, guessMapping(table), { ownIban });
};

const essentials = (line: ParsedLine) => ({
  bookingDate: line.bookingDate,
  amountCents: line.amountCents,
  counterparty: line.counterparty,
  counterpartyAccount: line.counterpartyAccount,
  reference: line.reference,
  message: line.message,
});

describe("Nordea's current layout", () => {
  it('is read as UTF-8, separated by semicolons, without the empty last column', () => {
    const table = readCsv(NORDEA);
    expect(table.encoding).toBe('utf-8');
    expect(table.delimiter).toBe(';');
    expect(table.columns).toEqual([
      'Kirjauspäivä', 'Määrä', 'Maksaja', 'Maksunsaaja', 'Nimi', 'Otsikko', 'Viesti', 'Viitenumero', 'Saldo', 'Valuutta',
    ]);
    expect(detectLayout(table)).toBe('nordea');
  });

  it('maps the name and the two account columns, and leaves the balance alone', () => {
    const table = readCsv(NORDEA);
    expect(guessMapping(table)).toEqual({
      bookingDate: [0],
      amount: [1],
      counterpartyAccount: [3, 2],
      counterparty: [4, 5],
      reference: [7],
      message: [6],
    });
  });

  it('gives the transactions oldest first, the other side of each as the counterparty', () => {
    const { lines, skipped } = linesOf(NORDEA);
    expect(lines.map(essentials)).toEqual([
      { bookingDate: '2026-10-01', amountCents: -3000, counterparty: 'Kerho ry', counterpartyAccount: 'FI4757900000011111', reference: '', message: '' },
      { bookingDate: '2026-10-03', amountCents: -450, counterparty: 'Kioski', counterpartyAccount: '', reference: '', message: '' },
      { bookingDate: '2026-10-03', amountCents: -450, counterparty: 'Kioski', counterpartyAccount: '', reference: '', message: '' },
      { bookingDate: '2026-10-05', amountCents: 150000, counterparty: 'Asiakas Oy', counterpartyAccount: '', reference: '', message: 'Lasku 1001' },
      // No name: the title stands in for it.
      { bookingDate: '2026-10-10', amountCents: -999, counterparty: 'Korttiosto', counterpartyAccount: '', reference: '', message: '' },
      { bookingDate: '2026-10-12', amountCents: -12000, counterparty: 'Vuokranantaja Oy', counterpartyAccount: 'FI5940008000123456', reference: '', message: 'Vuokra lokakuu' },
      { bookingDate: '2026-10-15', amountCents: -4520, counterparty: 'Sähkö Oy', counterpartyAccount: '', reference: '00000000000000012345', message: '' },
    ]);
    // The pending card payment is no transaction yet.
    expect(skipped).toEqual([{ lineNumber: 2, reason: 'pending' }]);
    expect(lines[0]!.lineNumber).toBe(9);
  });

  it("can't tell its own account apart without knowing it", () => {
    const { lines } = linesOf(NORDEA, null);
    const deposit = lines.find((line) => line.amountCents > 0)!;
    expect(deposit.counterpartyAccount).toBe(OWN);
  });

  it('names its account in the file name', () => {
    expect(ibanInText(`Käyttötili ${OWN_SPACED} - 2026-10-17 14.28.53.csv`)).toBe(OWN);
    expect(ibanInText('tapahtumat20260301-20260331.csv')).toBeNull();
  });
});

describe("OP's layout", () => {
  it('is read as Windows-1252, with the header-only separator at the end dropped', () => {
    const table = readCsv(OP);
    expect(table.encoding).toBe('windows-1252');
    expect(table.columns).toHaveLength(10);
    expect(table.columns[0]).toBe('Kirjauspäivä');
    expect(detectLayout(table)).toBe('op');
  });

  it('takes "Selitys" as the type over the number code of "Laji", and the archive ID', () => {
    const table = readCsv(OP);
    expect(guessMapping(table)).toEqual({
      bookingDate: [0],
      valueDate: [1],
      amount: [2],
      archiveId: [9],
      reference: [7],
      counterpartyAccount: [6],
      counterparty: [5],
      transactionType: [4],
      message: [8],
    });
  });

  it('splits the BIC off the account and reads signed amounts with thousands separators', () => {
    const { lines, skipped } = linesOf(OP);
    expect(skipped).toEqual([]);
    expect(lines.map((line) => [line.amountCents, line.counterpartyAccount, line.transactionType, line.archiveId])).toEqual([
      [-5000, 'FI5940008000123456', 'TILISIIRTO', '20260304/5ABCDE/012345'],
      [125000, 'FI4757900000011111', 'PANO', '20260305/5ABCDE/012346'],
      [-1234, '', 'KORTTIOSTO', '20260306/5ABCDE/012347'],
    ]);
    expect(lines[2]!.counterparty).toBe('Kauppa Ä&Ö');
    expect(lines[0]!.valueDate).toBe('2026-03-04');
  });

  it('is recognised in its older variants', () => {
    const variant = windows1252(
      [
        'Kirjauspäivä;Arvopäivä;Määrä EUROA;Tapahtumalajikoodi;Selitys;Saaja/Maksaja;Saajan tilinumero;Viite;Viesti;Arkistotunnus;',
        '01.02.2016;01.02.2016;-5,00;106;TILISIIRTO;Saaja;FI5940008000123456;;;20160201/X/1',
      ].join('\r\n'),
    );
    const table = readCsv(variant);
    expect(detectLayout(table)).toBe('op');
    const { lines } = parseLines(table, guessMapping(table));
    expect(lines[0]).toMatchObject({ amountCents: -500, transactionType: 'TILISIIRTO', archiveId: '20160201/X/1' });
  });
});

describe("Nordea's old layout", () => {
  it('is read past the account line, tab-separated, and names the account', () => {
    const table = readCsv(NORDEA_CLASSIC);
    expect(table.delimiter).toBe('\t');
    expect(table.accountIban).toBe(OWN);
    expect(detectLayout(table)).toBe('nordea-classic');
    const { lines } = parseLines(table, guessMapping(table), { ownIban: OWN });
    expect(lines.map((line) => [line.amountCents, line.counterparty, line.counterpartyAccount, line.transactionType, line.reference, line.message])).toEqual([
      [170012, 'Työnantaja Oy', '', 'Pano', '', 'Palkka'],
      [-1221, 'Ruokakauppa', '', 'Korttiosto', '987654321098', 'HELSINKI'],
      [-2000, 'Yhdistys ry', 'FI5940008000123456', 'Itsepalvelu', '4564564564', ''],
    ]);
  });
});

describe('a layout not known by name', () => {
  it('is read by the names of its columns', () => {
    const file = Buffer.from(
      ['"Päivämäärä","Saaja/Maksaja","Selite","Viite/Viesti","Määrä"', '"02.03.2026","Kauppa","KORTTIOSTO","","-1,50"'].join('\n'),
    );
    const table = readCsv(file);
    expect(table.delimiter).toBe(',');
    expect(detectLayout(table)).toBeNull();
    const { lines } = parseLines(table, guessMapping(table));
    expect(lines).toEqual([
      expect.objectContaining({ bookingDate: '2026-03-02', amountCents: -150, counterparty: 'Kauppa', message: 'KORTTIOSTO' }),
    ]);
  });

  it('is read by its values when the names say nothing, money in and out in columns of their own', () => {
    const byValue = Buffer.from(['A;B;C', '2026-03-02;Jotain;12,00', '2026-03-03;Muuta;-3,10'].join('\n'));
    const table = readCsv(byValue);
    expect(guessMapping(table)).toEqual({ bookingDate: [0], amount: [2] });

    const inOut = Buffer.from(['Pvm;Kuvaus;Pano;Otto', '1.3.2026;Myynti;100,00;', '2.3.2026;Osto;;25,00'].join('\n'));
    const pair = readCsv(inOut);
    const mapping = guessMapping(pair);
    expect(mapping).toMatchObject({ bookingDate: [0], amountIn: [2], amountOut: [3], message: [1] });
    expect(parseLines(pair, mapping).lines.map((line) => line.amountCents)).toEqual([10000, -2500]);
  });

  it('has no header when its first row holds a date', () => {
    const table = readCsv(Buffer.from('04.03.2026;04.03.2026;-50,00;TILISIIRTO\n05.03.2026;05.03.2026;10,00;PANO\n'));
    expect(table.columns).toEqual(['#1', '#2', '#3', '#4']);
    expect(table.rows).toHaveLength(2);
  });

  it('is refused when it is no CSV at all', () => {
    expect(() => readCsv(Buffer.from('%PDF-1.4\n...'))).toThrow('not a CSV file');
    expect(() => readCsv(Buffer.alloc(0))).toThrow('empty');
  });
});

describe('rows that are no transactions', () => {
  it('are skipped with the reason: no date, no amount, another currency', () => {
    const table = readCsv(
      Buffer.from(['Kirjauspäivä;Määrä;Valuutta', 'Saldo;100,00;EUR', '01.03.2026;;EUR', '02.03.2026;5,00;SEK', '03.03.2026;5,00;EUR'].join('\n')),
    );
    const { lines, skipped } = parseLines(table, guessMapping(table));
    expect(lines).toHaveLength(1);
    expect(skipped).toEqual([
      { lineNumber: 2, reason: 'no-date' },
      { lineNumber: 3, reason: 'no-amount' },
      { lineNumber: 4, reason: 'currency' },
    ]);
  });
});

describe('values', () => {
  it('reads the date forms banks use', () => {
    expect(parseCsvDate('4.3.2026')).toBe('2026-03-04');
    expect(parseCsvDate('04.03.2026')).toBe('2026-03-04');
    expect(parseCsvDate('2026-03-04')).toBe('2026-03-04');
    expect(parseCsvDate('2026/03/04')).toBe('2026-03-04');
    expect(parseCsvDate('04.03.26')).toBe('2026-03-04');
    expect(parseCsvDate('30.02.2026')).toBeNull();
    expect(parseCsvDate('Varaus')).toBeNull();
  });

  it('reads amounts in cents, whatever their sign and separators', () => {
    expect(parseCsvAmount('-1 234,56')).toBe(-123456);
    expect(parseCsvAmount('-1 234,56')).toBe(-123456);
    expect(parseCsvAmount('+12,50')).toBe(1250);
    expect(parseCsvAmount('12,50-')).toBe(-1250);
    expect(parseCsvAmount('−12,50')).toBe(-1250);
    expect(parseCsvAmount('1.234,56')).toBe(123456);
    expect(parseCsvAmount('1,234.56')).toBe(123456);
    expect(parseCsvAmount('12.5')).toBe(1250);
    expect(parseCsvAmount('7')).toBe(700);
    expect(parseCsvAmount('-50,00 €')).toBe(-5000);
    expect(parseCsvAmount('0,1')).toBe(10);
    expect(parseCsvAmount('')).toBeNull();
    expect(parseCsvAmount('abc')).toBeNull();
  });

  it('cleans an account up to an IBAN when it is one', () => {
    expect(cleanAccount('FI59 4000 8000 1234 56 OKOYFIHH')).toBe('FI5940008000123456');
    expect(cleanAccount('fi5940008000123456')).toBe('FI5940008000123456');
    expect(cleanAccount('123456-789')).toBe('123456-789');
  });
});

describe('the columns chosen', () => {
  it('need a date and an amount, from columns the file has', () => {
    expect(checkMapping({ bookingDate: [0], amount: [1] }, 3)).toBeNull();
    expect(checkMapping({ bookingDate: [0], amountOut: [2] }, 3)).toBeNull();
    expect(checkMapping({ amount: [1] }, 3)).toMatch(/booking date/);
    expect(checkMapping({ bookingDate: [0] }, 3)).toMatch(/amount/);
    expect(checkMapping({ bookingDate: [0], amount: [5] }, 3)).toMatch(/does not have/);
  });
});

describe('dedupeKeys', () => {
  it("uses the bank's archive ID when there is one", () => {
    const { lines } = linesOf(OP);
    expect(dedupeKeys(lines)).toEqual([
      'a:20260304/5ABCDE/012345',
      'a:20260305/5ABCDE/012346',
      'a:20260306/5ABCDE/012347',
    ]);
  });

  it('numbers identical transactions, so both stay and a re-import gives the same keys', () => {
    const { lines } = linesOf(NORDEA);
    const keys = dedupeKeys(lines);
    expect(new Set(keys).size).toBe(keys.length);
    const [, first, second] = keys;
    expect(first!.replace(/:\d+$/, '')).toBe(second!.replace(/:\d+$/, ''));
    expect([first!.slice(-2), second!.slice(-2)]).toEqual([':1', ':2']);
    expect(dedupeKeys(linesOf(NORDEA).lines)).toEqual(keys);
  });
});
