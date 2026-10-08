import type {
  AccountMainClass,
  BalanceSheetItem,
  IncomeStatementSubItem,
} from '../generated/prisma/client';
import { balanceSheetItemBelongsTo } from './balanceSheetScheme';
import { subItemBelongsTo } from './incomeStatementScheme';

// Curated Finnish standard chart of accounts for small and medium enterprises,
// used to seed a new company (chart-of-accounts.service.ts). Numbering follows
// the conventional Finnish layout (1xxx assets, 2xxx equity & liabilities,
// 3xxx revenue, 4xxx-9xxx expenses/appropriations). VAT rates reflect the 2025
// Finnish rates (general 25.5 %, reduced 14 % and 10 %). It is a starting
// point: companies add, rename, and remove accounts freely.

export interface SeedAccount {
  number: string;
  name: string;
}

export interface SeedGroup {
  name: string;
  mainClass: AccountMainClass;
  // Lettered sub-item of the income statement layout, where the group's main
  // class has them.
  subItem?: IncomeStatementSubItem;
  // Item of the balance sheet layout, for balance sheet groups.
  balanceSheetItem?: BalanceSheetItem;
  accounts: SeedAccount[];
}

// The accounts of the chart below that generated VAT rows post to (see
// lib/vat.ts). Seeding sets them as the company's VAT accounts.
export const DEFAULT_VAT_RECEIVABLE_ACCOUNT_NUMBER = '1763';
export const DEFAULT_VAT_PAYABLE_ACCOUNT_NUMBER = '2939';

export const DEFAULT_CHART_OF_ACCOUNTS: SeedGroup[] = [
  // --- Vastaavaa: A Pysyvät vastaavat ---
  // One group per item of the statutory layout (PMA 1753/2015, Annex V) here
  // too, so a freshly seeded chart produces a complete balance sheet.

  // I Aineettomat hyödykkeet
  {
    name: 'Kehittämismenot',
    mainClass: 'FIXED_ASSETS',
    balanceSheetItem: 'DEVELOPMENT_EXPENDITURE',
    accounts: [{ number: '1000', name: 'Kehittämismenot' }],
  },
  {
    name: 'Aineettomat oikeudet',
    mainClass: 'FIXED_ASSETS',
    balanceSheetItem: 'INTANGIBLE_RIGHTS',
    accounts: [{ number: '1010', name: 'Aineettomat oikeudet' }],
  },
  {
    name: 'Liikearvo',
    mainClass: 'FIXED_ASSETS',
    balanceSheetItem: 'GOODWILL',
    accounts: [{ number: '1020', name: 'Liikearvo' }],
  },
  {
    name: 'Muut aineettomat hyödykkeet',
    mainClass: 'FIXED_ASSETS',
    balanceSheetItem: 'OTHER_INTANGIBLE_ASSETS',
    accounts: [{ number: '1030', name: 'Muut aineettomat hyödykkeet' }],
  },

  // II Aineelliset hyödykkeet
  {
    name: 'Maa- ja vesialueet',
    mainClass: 'FIXED_ASSETS',
    balanceSheetItem: 'LAND_AND_WATERS',
    accounts: [{ number: '1100', name: 'Maa- ja vesialueet' }],
  },
  {
    name: 'Rakennukset ja rakennelmat',
    mainClass: 'FIXED_ASSETS',
    balanceSheetItem: 'BUILDINGS_AND_STRUCTURES',
    accounts: [{ number: '1120', name: 'Rakennukset ja rakennelmat' }],
  },
  {
    name: 'Koneet ja kalusto',
    mainClass: 'FIXED_ASSETS',
    balanceSheetItem: 'MACHINERY_AND_EQUIPMENT',
    accounts: [{ number: '1150', name: 'Koneet ja kalusto' }],
  },
  {
    name: 'Muut aineelliset hyödykkeet',
    mainClass: 'FIXED_ASSETS',
    balanceSheetItem: 'OTHER_TANGIBLE_ASSETS',
    accounts: [{ number: '1180', name: 'Muut aineelliset hyödykkeet' }],
  },

  // III Sijoitukset
  {
    name: 'Osuudet saman konsernin yrityksissä',
    mainClass: 'FIXED_ASSETS',
    balanceSheetItem: 'INVESTMENT_HOLDINGS_IN_GROUP_UNDERTAKINGS',
    accounts: [{ number: '1300', name: 'Osuudet saman konsernin yrityksissä' }],
  },
  {
    name: 'Muut osakkeet ja osuudet',
    mainClass: 'FIXED_ASSETS',
    balanceSheetItem: 'INVESTMENT_OTHER_SHARES_AND_HOLDINGS',
    accounts: [{ number: '1350', name: 'Muut osakkeet ja osuudet' }],
  },

  // --- Vastaavaa: B Vaihtuvat vastaavat ---

  // I Vaihto-omaisuus
  {
    name: 'Aineet ja tarvikkeet',
    mainClass: 'CURRENT_ASSETS',
    balanceSheetItem: 'RAW_MATERIALS_AND_CONSUMABLES',
    accounts: [{ number: '1500', name: 'Aineet ja tarvikkeet' }],
  },
  {
    name: 'Valmiit tuotteet ja tavarat',
    mainClass: 'CURRENT_ASSETS',
    balanceSheetItem: 'FINISHED_GOODS',
    accounts: [
      { number: '1540', name: 'Valmiit tuotteet' },
      { number: '1560', name: 'Tavarat' },
    ],
  },

  // II Saamiset. The seeded receivables are short-term; a company with
  // long-term ones adds groups for them.
  {
    name: 'Myyntisaamiset',
    mainClass: 'CURRENT_ASSETS',
    balanceSheetItem: 'SHORT_TERM_TRADE_RECEIVABLES',
    accounts: [{ number: '1700', name: 'Myyntisaamiset' }],
  },
  {
    name: 'Muut saamiset',
    mainClass: 'CURRENT_ASSETS',
    balanceSheetItem: 'SHORT_TERM_OTHER_RECEIVABLES',
    accounts: [
      { number: '1730', name: 'Muut saamiset' },
      { number: '1763', name: 'Arvonlisäverosaaminen' },
    ],
  },
  {
    name: 'Siirtosaamiset',
    mainClass: 'CURRENT_ASSETS',
    balanceSheetItem: 'SHORT_TERM_PREPAYMENTS_AND_ACCRUED_INCOME',
    accounts: [{ number: '1750', name: 'Siirtosaamiset' }],
  },

  // IV Rahat ja pankkisaamiset
  {
    name: 'Rahat ja pankkisaamiset',
    mainClass: 'CURRENT_ASSETS',
    balanceSheetItem: 'CASH_AND_BANK',
    accounts: [
      { number: '1900', name: 'Käteisvarat' },
      { number: '1910', name: 'Pankkitili' },
    ],
  },

  // --- Vastattavaa: A Oma pääoma ---
  {
    name: 'Osake- tai osuuspääoma',
    mainClass: 'EQUITY',
    balanceSheetItem: 'SHARE_CAPITAL',
    accounts: [{ number: '2000', name: 'Osake- tai osuuspääoma' }],
  },
  {
    name: 'Ylikurssirahasto',
    mainClass: 'EQUITY',
    balanceSheetItem: 'SHARE_PREMIUM_RESERVE',
    accounts: [{ number: '2010', name: 'Ylikurssirahasto' }],
  },
  {
    name: 'Sijoitetun vapaan oman pääoman rahasto',
    mainClass: 'EQUITY',
    balanceSheetItem: 'INVESTED_UNRESTRICTED_EQUITY_RESERVE',
    accounts: [{ number: '2040', name: 'Sijoitetun vapaan oman pääoman rahasto' }],
  },

  // The balance sheet derives both result items from the income statement
  // accounts (see src/lib/balanceSheet.ts); these accounts are for entries a
  // company books to them itself, such as a dividend out of earlier profits.
  {
    name: 'Edellisten tilikausien voitto (tappio)',
    mainClass: 'EQUITY',
    balanceSheetItem: 'RETAINED_EARNINGS',
    accounts: [{ number: '2050', name: 'Edellisten tilikausien voitto/tappio' }],
  },
  {
    name: 'Tilikauden voitto (tappio)',
    mainClass: 'EQUITY',
    balanceSheetItem: 'PROFIT_FOR_THE_FINANCIAL_YEAR',
    accounts: [{ number: '2070', name: 'Tilikauden voitto/tappio' }],
  },

  // Private drawings and investments of a sole trader: part of the "muu
  // vastaava pääoma" of item I.
  {
    name: 'Yksityistilit',
    mainClass: 'EQUITY',
    balanceSheetItem: 'SHARE_CAPITAL',
    accounts: [{ number: '2080', name: 'Yksityiskäyttötili' }],
  },

  // --- Vastattavaa: B Tilinpäätössiirtojen kertymä ---
  {
    name: 'Poistoero',
    mainClass: 'ACCUMULATED_APPROPRIATIONS',
    balanceSheetItem: 'DEPRECIATION_DIFFERENCE',
    accounts: [{ number: '2200', name: 'Poistoero' }],
  },
  {
    name: 'Verotusperusteiset varaukset',
    mainClass: 'ACCUMULATED_APPROPRIATIONS',
    balanceSheetItem: 'TAX_BASED_PROVISIONS',
    accounts: [{ number: '2250', name: 'Verotusperusteiset varaukset' }],
  },

  // --- Vastattavaa: C Pakolliset varaukset ---
  {
    name: 'Eläkevaraukset',
    mainClass: 'PROVISIONS',
    balanceSheetItem: 'PENSION_PROVISIONS',
    accounts: [{ number: '2300', name: 'Eläkevaraukset' }],
  },
  {
    name: 'Muut pakolliset varaukset',
    mainClass: 'PROVISIONS',
    balanceSheetItem: 'OTHER_PROVISIONS',
    accounts: [{ number: '2320', name: 'Muut pakolliset varaukset' }],
  },

  // --- Vastattavaa: D Vieras pääoma ---

  // Pitkäaikainen
  {
    name: 'Lainat rahoituslaitoksilta',
    mainClass: 'LIABILITIES',
    balanceSheetItem: 'LONG_TERM_LOANS_FROM_FINANCIAL_INSTITUTIONS',
    accounts: [{ number: '2600', name: 'Lainat rahoituslaitoksilta' }],
  },
  {
    name: 'Muut pitkäaikaiset velat',
    mainClass: 'LIABILITIES',
    balanceSheetItem: 'LONG_TERM_OTHER_LIABILITIES',
    accounts: [{ number: '2620', name: 'Muut pitkäaikaiset velat' }],
  },

  // Lyhytaikainen
  {
    name: 'Ostovelat',
    mainClass: 'LIABILITIES',
    balanceSheetItem: 'SHORT_TERM_TRADE_PAYABLES',
    accounts: [{ number: '2700', name: 'Ostovelat' }],
  },
  {
    name: 'Saadut ennakot',
    mainClass: 'LIABILITIES',
    balanceSheetItem: 'SHORT_TERM_ADVANCES_RECEIVED',
    accounts: [{ number: '2710', name: 'Saadut ennakot' }],
  },
  {
    name: 'Muut lyhytaikaiset velat',
    mainClass: 'LIABILITIES',
    balanceSheetItem: 'SHORT_TERM_OTHER_LIABILITIES',
    accounts: [
      { number: '2730', name: 'Muut lyhytaikaiset velat' },
      { number: '2920', name: 'Ennakonpidätysvelka' },
      { number: '2925', name: 'Sosiaaliturvamaksuvelka' },
      { number: '2939', name: 'Arvonlisäverovelka' },
    ],
  },
  {
    name: 'Siirtovelat',
    mainClass: 'LIABILITIES',
    balanceSheetItem: 'SHORT_TERM_ACCRUALS_AND_DEFERRED_INCOME',
    accounts: [{ number: '2740', name: 'Siirtovelat' }],
  },

  // --- Tuloslaskelma ---
  // One group per leaf of the statutory layout (PMA 1753/2015, Annex I), so
  // a freshly seeded chart produces a complete income statement. Items 2
  // (varastojen muutos, valmiit tuotteet) and 3 (valmistus omaan käyttöön)
  // are left out: few small companies need them, and they can be added.

  // 1. Liikevaihto
  {
    name: 'Liikevaihto',
    mainClass: 'REVENUE',
    accounts: [
      { number: '3000', name: 'Myynti (yleinen verokanta 25,5 %)' },
      { number: '3010', name: 'Myynti 14 %' },
      { number: '3020', name: 'Myynti 10 %' },
      { number: '3030', name: 'Veroton myynti (EU ja vienti)' },
    ],
  },

  // 4. Liiketoiminnan muut tuotot
  {
    name: 'Liiketoiminnan muut tuotot',
    mainClass: 'OTHER_OPERATING_INCOME',
    accounts: [{ number: '3600', name: 'Liiketoiminnan muut tuotot' }],
  },

  // 5. Materiaalit ja palvelut
  {
    name: 'Ostot tilikauden aikana',
    mainClass: 'MATERIALS_AND_SERVICES',
    subItem: 'PURCHASES',
    accounts: [{ number: '4000', name: 'Ostot tilikauden aikana' }],
  },
  {
    name: 'Varastojen muutos',
    mainClass: 'MATERIALS_AND_SERVICES',
    subItem: 'CHANGE_IN_INVENTORIES',
    accounts: [{ number: '4400', name: 'Varastojen muutos' }],
  },
  {
    name: 'Ulkopuoliset palvelut',
    mainClass: 'MATERIALS_AND_SERVICES',
    subItem: 'EXTERNAL_SERVICES',
    accounts: [{ number: '4500', name: 'Ulkopuoliset palvelut' }],
  },

  // 6. Henkilöstökulut
  {
    name: 'Palkat ja palkkiot',
    mainClass: 'PERSONNEL_EXPENSES',
    subItem: 'WAGES_AND_SALARIES',
    accounts: [{ number: '5000', name: 'Palkat ja palkkiot' }],
  },
  {
    name: 'Eläkekulut',
    mainClass: 'PERSONNEL_EXPENSES',
    subItem: 'PENSION_EXPENSES',
    accounts: [{ number: '5100', name: 'Eläkekulut' }],
  },
  {
    name: 'Muut henkilösivukulut',
    mainClass: 'PERSONNEL_EXPENSES',
    subItem: 'OTHER_SOCIAL_SECURITY_EXPENSES',
    accounts: [{ number: '5200', name: 'Muut henkilösivukulut' }],
  },

  // 7. Poistot ja arvonalentumiset
  {
    name: 'Suunnitelman mukaiset poistot',
    mainClass: 'DEPRECIATION',
    subItem: 'PLANNED_DEPRECIATION',
    accounts: [{ number: '6800', name: 'Suunnitelman mukaiset poistot' }],
  },

  // 8. Liiketoiminnan muut kulut
  {
    name: 'Liiketoiminnan muut kulut',
    mainClass: 'OTHER_OPERATING_EXPENSES',
    accounts: [
      { number: '7200', name: 'Toimitilakulut' },
      { number: '7300', name: 'Ajoneuvokulut' },
      { number: '7400', name: 'Kone- ja kalustokulut' },
      { number: '7500', name: 'Matkakulut' },
      { number: '7600', name: 'Markkinointikulut' },
      { number: '7700', name: 'Hallinnon kulut' },
      { number: '7800', name: 'Muut liiketoiminnan kulut' },
    ],
  },

  // 10. Rahoitustuotot ja -kulut
  {
    name: 'Muut korko- ja rahoitustuotot',
    mainClass: 'FINANCIAL_INCOME_AND_EXPENSES',
    subItem: 'OTHER_INTEREST_AND_FINANCIAL_INCOME',
    accounts: [
      { number: '8000', name: 'Korkotuotot' },
      { number: '8100', name: 'Muut rahoitustuotot' },
    ],
  },
  {
    name: 'Korkokulut ja muut rahoituskulut',
    mainClass: 'FINANCIAL_INCOME_AND_EXPENSES',
    subItem: 'INTEREST_AND_OTHER_FINANCIAL_EXPENSES',
    accounts: [
      { number: '8200', name: 'Korkokulut' },
      { number: '8300', name: 'Muut rahoituskulut' },
    ],
  },

  // 12. Tilinpäätössiirrot
  {
    name: 'Poistoeron muutos',
    mainClass: 'APPROPRIATIONS',
    subItem: 'CHANGE_IN_DEPRECIATION_DIFFERENCE',
    accounts: [{ number: '9000', name: 'Poistoeron muutos' }],
  },

  // 13. Tuloverot
  {
    name: 'Tuloverot',
    mainClass: 'INCOME_TAXES',
    accounts: [{ number: '9200', name: 'Tuloverot' }],
  },

  // 14. Muut välittömät verot
  {
    name: 'Muut välittömät verot',
    mainClass: 'OTHER_DIRECT_TAXES',
    accounts: [{ number: '9300', name: 'Muut välittömät verot' }],
  },
];

// Guards the seed data's internal consistency (used by a unit test): account
// numbers must be globally unique within the chart, group names distinct, and
// every sub-item and balance sheet item must belong to its group's main class.
// The default chart itself must also hold the two default VAT accounts.
export function assertDefaultChartIntegrity(chart: SeedGroup[] = DEFAULT_CHART_OF_ACCOUNTS): void {
  const numbers = new Set<string>();
  const groupNames = new Set<string>();
  for (const group of chart) {
    if (groupNames.has(group.name)) {
      throw new Error(`Duplicate group name in default chart: ${group.name}`);
    }
    groupNames.add(group.name);
    if (group.subItem && !subItemBelongsTo(group.mainClass, group.subItem)) {
      throw new Error(`Sub-item ${group.subItem} does not belong to ${group.mainClass}: ${group.name}`);
    }
    if (
      group.balanceSheetItem &&
      !balanceSheetItemBelongsTo(group.mainClass, group.balanceSheetItem)
    ) {
      throw new Error(
        `Balance sheet item ${group.balanceSheetItem} does not belong to ${group.mainClass}: ${group.name}`,
      );
    }
    for (const account of group.accounts) {
      if (numbers.has(account.number)) {
        throw new Error(`Duplicate account number in default chart: ${account.number}`);
      }
      numbers.add(account.number);
    }
  }
  if (chart === DEFAULT_CHART_OF_ACCOUNTS) {
    for (const number of [DEFAULT_VAT_RECEIVABLE_ACCOUNT_NUMBER, DEFAULT_VAT_PAYABLE_ACCOUNT_NUMBER]) {
      if (!numbers.has(number)) {
        throw new Error(`Default VAT account ${number} is missing from the default chart`);
      }
    }
  }
}
