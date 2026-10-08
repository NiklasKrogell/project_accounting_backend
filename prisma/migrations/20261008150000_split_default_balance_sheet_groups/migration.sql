-- Data migration: brings charts seeded from the OLD default chart of accounts
-- in line with the statutory balance sheet layout (PMA 1753/2015, Annex V).
--
-- The old default chart had one group per roman-numeral heading ("Aineettomat
-- hyödykkeet" holding 1000-1030, ...). The layout needs each account under a
-- numbered item, so each old default group is split the way the current
-- default chart (src/lib/defaultChartOfAccounts.ts) is: one group per item.
-- The old chart's receivables and "Lyhytaikainen vieras pääoma" become
-- short-term items, "Pitkäaikainen vieras pääoma" long-term ones.
--
-- Same rules as 20261008130000_split_default_income_statement_groups: only
-- accounts that are recognisably the seeded ones are moved (still in a group
-- with the old default name and class, no item yet, default number). Anything
-- a company added or regrouped itself is left alone and keeps showing as "not
-- allocated to an item" on the balance sheet until classified by hand.
--
-- Safe to re-run: after one pass nothing matches any more.

CREATE TEMP TABLE "_default_group_split" (
  old_name       TEXT NOT NULL,
  old_class      "AccountMainClass" NOT NULL,
  account_number TEXT NOT NULL,
  new_name       TEXT NOT NULL,
  new_item       "BalanceSheetItem" NOT NULL
);

INSERT INTO "_default_group_split" VALUES
  -- A I Aineettomat hyödykkeet
  ('Aineettomat hyödykkeet', 'FIXED_ASSETS', '1000', 'Kehittämismenot', 'DEVELOPMENT_EXPENDITURE'),
  ('Aineettomat hyödykkeet', 'FIXED_ASSETS', '1010', 'Aineettomat oikeudet', 'INTANGIBLE_RIGHTS'),
  ('Aineettomat hyödykkeet', 'FIXED_ASSETS', '1020', 'Liikearvo', 'GOODWILL'),
  ('Aineettomat hyödykkeet', 'FIXED_ASSETS', '1030', 'Muut aineettomat hyödykkeet', 'OTHER_INTANGIBLE_ASSETS'),
  -- A II Aineelliset hyödykkeet
  ('Aineelliset hyödykkeet', 'FIXED_ASSETS', '1100', 'Maa- ja vesialueet', 'LAND_AND_WATERS'),
  ('Aineelliset hyödykkeet', 'FIXED_ASSETS', '1120', 'Rakennukset ja rakennelmat', 'BUILDINGS_AND_STRUCTURES'),
  ('Aineelliset hyödykkeet', 'FIXED_ASSETS', '1150', 'Koneet ja kalusto', 'MACHINERY_AND_EQUIPMENT'),
  ('Aineelliset hyödykkeet', 'FIXED_ASSETS', '1180', 'Muut aineelliset hyödykkeet', 'OTHER_TANGIBLE_ASSETS'),
  -- A III Sijoitukset
  ('Sijoitukset', 'FIXED_ASSETS', '1300', 'Osuudet saman konsernin yrityksissä', 'INVESTMENT_HOLDINGS_IN_GROUP_UNDERTAKINGS'),
  ('Sijoitukset', 'FIXED_ASSETS', '1350', 'Muut osakkeet ja osuudet', 'INVESTMENT_OTHER_SHARES_AND_HOLDINGS'),
  -- B I Vaihto-omaisuus
  ('Vaihto-omaisuus', 'CURRENT_ASSETS', '1500', 'Aineet ja tarvikkeet', 'RAW_MATERIALS_AND_CONSUMABLES'),
  ('Vaihto-omaisuus', 'CURRENT_ASSETS', '1540', 'Valmiit tuotteet ja tavarat', 'FINISHED_GOODS'),
  ('Vaihto-omaisuus', 'CURRENT_ASSETS', '1560', 'Valmiit tuotteet ja tavarat', 'FINISHED_GOODS'),
  -- B II Saamiset (lyhytaikaiset)
  ('Saamiset', 'CURRENT_ASSETS', '1700', 'Myyntisaamiset', 'SHORT_TERM_TRADE_RECEIVABLES'),
  ('Saamiset', 'CURRENT_ASSETS', '1730', 'Muut saamiset', 'SHORT_TERM_OTHER_RECEIVABLES'),
  ('Saamiset', 'CURRENT_ASSETS', '1763', 'Muut saamiset', 'SHORT_TERM_OTHER_RECEIVABLES'),
  ('Saamiset', 'CURRENT_ASSETS', '1750', 'Siirtosaamiset', 'SHORT_TERM_PREPAYMENTS_AND_ACCRUED_INCOME'),
  -- A Oma pääoma
  ('Oma pääoma', 'EQUITY', '2000', 'Osake- tai osuuspääoma', 'SHARE_CAPITAL'),
  ('Oma pääoma', 'EQUITY', '2080', 'Yksityistilit', 'SHARE_CAPITAL'),
  ('Oma pääoma', 'EQUITY', '2010', 'Ylikurssirahasto', 'SHARE_PREMIUM_RESERVE'),
  ('Oma pääoma', 'EQUITY', '2040', 'Sijoitetun vapaan oman pääoman rahasto', 'INVESTED_UNRESTRICTED_EQUITY_RESERVE'),
  ('Oma pääoma', 'EQUITY', '2050', 'Edellisten tilikausien voitto (tappio)', 'RETAINED_EARNINGS'),
  ('Oma pääoma', 'EQUITY', '2070', 'Tilikauden voitto (tappio)', 'PROFIT_FOR_THE_FINANCIAL_YEAR'),
  -- C Pakolliset varaukset
  ('Pakolliset varaukset', 'PROVISIONS', '2300', 'Eläkevaraukset', 'PENSION_PROVISIONS'),
  ('Pakolliset varaukset', 'PROVISIONS', '2320', 'Muut pakolliset varaukset', 'OTHER_PROVISIONS'),
  -- D Vieras pääoma, pitkäaikainen
  ('Pitkäaikainen vieras pääoma', 'LIABILITIES', '2600', 'Lainat rahoituslaitoksilta', 'LONG_TERM_LOANS_FROM_FINANCIAL_INSTITUTIONS'),
  ('Pitkäaikainen vieras pääoma', 'LIABILITIES', '2620', 'Muut pitkäaikaiset velat', 'LONG_TERM_OTHER_LIABILITIES'),
  -- D Vieras pääoma, lyhytaikainen
  ('Lyhytaikainen vieras pääoma', 'LIABILITIES', '2700', 'Ostovelat', 'SHORT_TERM_TRADE_PAYABLES'),
  ('Lyhytaikainen vieras pääoma', 'LIABILITIES', '2710', 'Saadut ennakot', 'SHORT_TERM_ADVANCES_RECEIVED'),
  ('Lyhytaikainen vieras pääoma', 'LIABILITIES', '2730', 'Muut lyhytaikaiset velat', 'SHORT_TERM_OTHER_LIABILITIES'),
  ('Lyhytaikainen vieras pääoma', 'LIABILITIES', '2920', 'Muut lyhytaikaiset velat', 'SHORT_TERM_OTHER_LIABILITIES'),
  ('Lyhytaikainen vieras pääoma', 'LIABILITIES', '2925', 'Muut lyhytaikaiset velat', 'SHORT_TERM_OTHER_LIABILITIES'),
  ('Lyhytaikainen vieras pääoma', 'LIABILITIES', '2939', 'Muut lyhytaikaiset velat', 'SHORT_TERM_OTHER_LIABILITIES'),
  ('Lyhytaikainen vieras pääoma', 'LIABILITIES', '2740', 'Siirtovelat', 'SHORT_TERM_ACCRUALS_AND_DEFERRED_INCOME');

-- 0. "Rahat ja pankkisaamiset" is a single item of the layout already, so the
--    old default group is classified in place, own accounts and all.
UPDATE "AccountGroup"
SET "balanceSheetItem" = 'CASH_AND_BANK', "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Rahat ja pankkisaamiset'
  AND "mainClass" = 'CURRENT_ASSETS'
  AND "balanceSheetItem" IS NULL;

-- 1. Create the target groups a company needs and doesn't have. A company
--    that already uses the name for something else keeps its group untouched
--    (names are unique per company); step 2 then simply finds no target.
INSERT INTO "AccountGroup"
  ("id", "name", "mainClass", "balanceSheetItem", "companyId", "chartOfAccountsId", "updatedAt")
SELECT gen_random_uuid()::text, needed.new_name, needed.old_class, needed.new_item,
       needed."companyId", needed."chartOfAccountsId", CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT m.new_name, m.old_class, m.new_item, g."companyId", g."chartOfAccountsId"
  FROM "_default_group_split" m
  JOIN "AccountGroup" g
    ON g."name" = m.old_name AND g."mainClass" = m.old_class AND g."balanceSheetItem" IS NULL
  JOIN "Account" a ON a."accountGroupId" = g."id" AND a."number" = m.account_number
) needed
WHERE NOT EXISTS (
  SELECT 1 FROM "AccountGroup" x
  WHERE x."companyId" = needed."companyId" AND x."name" = needed.new_name
);

-- 2. Every account to move, with its old and new group. The target must
--    match on class and item too, not just name, so an account is never moved
--    into an unrelated group that happens to share the name.
CREATE TEMP TABLE "_account_moves" AS
SELECT a."id" AS account_id, g."id" AS old_group_id, n."id" AS new_group_id
FROM "_default_group_split" m
JOIN "AccountGroup" g
  ON g."name" = m.old_name AND g."mainClass" = m.old_class AND g."balanceSheetItem" IS NULL
JOIN "Account" a ON a."accountGroupId" = g."id" AND a."number" = m.account_number
JOIN "AccountGroup" n
  ON n."companyId" = g."companyId"
 AND n."name" = m.new_name
 AND n."mainClass" = m.old_class
 AND n."balanceSheetItem" = m.new_item;

UPDATE "Account" a
SET "accountGroupId" = mv.new_group_id, "updatedAt" = CURRENT_TIMESTAMP
FROM "_account_moves" mv
WHERE a."id" = mv.account_id;

-- 3. Remove the old default groups this migration emptied. A group that still
--    holds accounts (ones the company added itself) stays.
DELETE FROM "AccountGroup" g
WHERE g."id" IN (SELECT old_group_id FROM "_account_moves")
  AND NOT EXISTS (SELECT 1 FROM "Account" a WHERE a."accountGroupId" = g."id");

DROP TABLE "_account_moves";
DROP TABLE "_default_group_split";
