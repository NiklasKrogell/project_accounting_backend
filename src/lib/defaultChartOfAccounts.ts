import type { AccountMainClass } from '../generated/prisma/client';

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

  // --- Tuloslaskelma: liikevaihto ---
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

  // --- Tuloslaskelma: materiaalit ja palvelut ---
  {
    name: 'Materiaalit ja palvelut',
    mainClass: 'MATERIALS_AND_SERVICES',
    accounts: [
      { number: '4000', name: 'Ostot tilikauden aikana' },
      { number: '4400', name: 'Varastojen muutos' },
      { number: '4500', name: 'Ulkopuoliset palvelut' },
    ],
  },

  // --- Tuloslaskelma: henkilöstökulut ---
  {
    name: 'Henkilöstökulut',
    mainClass: 'PERSONNEL_EXPENSES',
    accounts: [
      { number: '5000', name: 'Palkat ja palkkiot' },
      { number: '5100', name: 'Eläkekulut' },
      { number: '5200', name: 'Muut henkilösivukulut' },
    ],
  },

  // --- Tuloslaskelma: poistot ---
  {
    name: 'Poistot ja arvonalentumiset',
    mainClass: 'DEPRECIATION',
    accounts: [{ number: '6800', name: 'Suunnitelman mukaiset poistot' }],
  },

  // --- Tuloslaskelma: liiketoiminnan muut kulut ---
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

  // --- Tuloslaskelma: rahoitustuotot ja -kulut ---
  {
    name: 'Rahoitustuotot ja -kulut',
    mainClass: 'FINANCIAL_INCOME_AND_EXPENSES',
    accounts: [
      { number: '8000', name: 'Korkotuotot' },
      { number: '8100', name: 'Muut rahoitustuotot' },
      { number: '8200', name: 'Korkokulut' },
      { number: '8300', name: 'Muut rahoituskulut' },
    ],
  },

  // --- Tuloslaskelma: tilinpäätössiirrot ja verot ---
  {
    name: 'Tilinpäätössiirrot ja verot',
    mainClass: 'APPROPRIATIONS_AND_TAXES',
    accounts: [
      { number: '9000', name: 'Poistoeron muutos' },
      { number: '9200', name: 'Tuloverot' },
      { number: '9300', name: 'Muut välittömät verot' },
    ],
  },
];

// Guards the seed data's internal consistency (used by a unit test): account
// numbers must be globally unique within the chart and group names distinct.
export function assertDefaultChartIntegrity(chart: SeedGroup[] = DEFAULT_CHART_OF_ACCOUNTS): void {
  const numbers = new Set<string>();
  const groupNames = new Set<string>();
  for (const group of chart) {
    if (groupNames.has(group.name)) {
      throw new Error(`Duplicate group name in default chart: ${group.name}`);
    }
    groupNames.add(group.name);
    for (const account of group.accounts) {
      if (numbers.has(account.number)) {
        throw new Error(`Duplicate account number in default chart: ${account.number}`);
      }
      numbers.add(account.number);
    }
  }
}
