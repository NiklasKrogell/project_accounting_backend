import type { AccountMainClass, IncomeStatementSubItem } from '../generated/prisma/client';
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
  accounts: SeedAccount[];
}

export const DEFAULT_CHART_OF_ACCOUNTS: SeedGroup[] = [
  // --- Vastaavaa: pysyvät vastaavat ---
  {
    name: 'Aineettomat hyödykkeet',
    mainClass: 'FIXED_ASSETS',
    accounts: [
      { number: '1000', name: 'Kehittämismenot' },
      { number: '1010', name: 'Aineettomat oikeudet' },
      { number: '1020', name: 'Liikearvo' },
      { number: '1030', name: 'Muut pitkävaikutteiset menot' },
    ],
  },
  {
    name: 'Aineelliset hyödykkeet',
    mainClass: 'FIXED_ASSETS',
    accounts: [
      { number: '1100', name: 'Maa- ja vesialueet' },
      { number: '1120', name: 'Rakennukset ja rakennelmat' },
      { number: '1150', name: 'Koneet ja kalusto' },
      { number: '1180', name: 'Muut aineelliset hyödykkeet' },
    ],
  },
  {
    name: 'Sijoitukset',
    mainClass: 'FIXED_ASSETS',
    accounts: [
      { number: '1300', name: 'Osuudet saman konsernin yrityksissä' },
      { number: '1350', name: 'Muut osakkeet ja osuudet' },
    ],
  },

  // --- Vastaavaa: vaihtuvat vastaavat ---
  {
    name: 'Vaihto-omaisuus',
    mainClass: 'CURRENT_ASSETS',
    accounts: [
      { number: '1500', name: 'Aineet ja tarvikkeet' },
      { number: '1540', name: 'Valmiit tuotteet' },
      { number: '1560', name: 'Tavarat' },
    ],
  },
  {
    name: 'Saamiset',
    mainClass: 'CURRENT_ASSETS',
    accounts: [
      { number: '1700', name: 'Myyntisaamiset' },
      { number: '1730', name: 'Muut saamiset' },
      { number: '1750', name: 'Siirtosaamiset' },
      { number: '1763', name: 'Arvonlisäverosaaminen' },
    ],
  },
  {
    name: 'Rahat ja pankkisaamiset',
    mainClass: 'CURRENT_ASSETS',
    accounts: [
      { number: '1900', name: 'Käteisvarat' },
      { number: '1910', name: 'Pankkitili' },
    ],
  },

  // --- Vastattavaa: oma pääoma ---
  {
    name: 'Oma pääoma',
    mainClass: 'EQUITY',
    accounts: [
      { number: '2000', name: 'Osake- tai osuuspääoma' },
      { number: '2010', name: 'Ylikurssirahasto' },
      { number: '2040', name: 'Sijoitetun vapaan oman pääoman rahasto' },
      { number: '2050', name: 'Edellisten tilikausien voitto/tappio' },
      { number: '2070', name: 'Tilikauden voitto/tappio' },
      { number: '2080', name: 'Yksityiskäyttötili' },
    ],
  },

  // --- Vastattavaa: pakolliset varaukset ---
  {
    name: 'Pakolliset varaukset',
    mainClass: 'PROVISIONS',
    accounts: [
      { number: '2300', name: 'Eläkevaraukset' },
      { number: '2320', name: 'Muut pakolliset varaukset' },
    ],
  },

  // --- Vastattavaa: vieras pääoma ---
  {
    name: 'Pitkäaikainen vieras pääoma',
    mainClass: 'LIABILITIES',
    accounts: [
      { number: '2600', name: 'Lainat rahoituslaitoksilta' },
      { number: '2620', name: 'Muut pitkäaikaiset velat' },
    ],
  },
  {
    name: 'Lyhytaikainen vieras pääoma',
    mainClass: 'LIABILITIES',
    accounts: [
      { number: '2700', name: 'Ostovelat' },
      { number: '2710', name: 'Saadut ennakot' },
      { number: '2730', name: 'Muut lyhytaikaiset velat' },
      { number: '2740', name: 'Siirtovelat' },
      { number: '2920', name: 'Ennakonpidätysvelka' },
      { number: '2925', name: 'Sosiaaliturvamaksuvelka' },
      { number: '2939', name: 'Arvonlisäverovelka' },
    ],
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
// every sub-item must belong to its group's main class.
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
    for (const account of group.accounts) {
      if (numbers.has(account.number)) {
        throw new Error(`Duplicate account number in default chart: ${account.number}`);
      }
      numbers.add(account.number);
    }
  }
}
