-- Data migration: brings charts seeded from the OLD default chart of accounts
-- in line with the statutory income statement layout (PMA 1753/2015, Annex I).
--
-- The old default chart had one group per main class ("Materiaalit ja
-- palvelut" holding 4000, 4400 and 4500, ...). The layout needs each account
-- under a lettered sub-item, and tax accounts out of "Tilinpäätössiirrot ja
-- verot", so each old default group is split the way the current default chart
-- (src/lib/defaultChartOfAccounts.ts) is: one group per sub-item.
--
-- Only accounts that are recognisably the seeded ones are moved: the account
-- must still sit in a group with the old default name and class (and no
-- sub-item yet) and still carry its default number. Anything a company added
-- or regrouped itself is left alone and keeps showing as "not allocated to a
-- sub-item" on the income statement until classified by hand.
--
-- Safe to re-run: after one pass nothing matches any more.

CREATE TEMP TABLE "_default_group_split" (
  old_name       TEXT NOT NULL,
  old_class      "AccountMainClass" NOT NULL,
  account_number TEXT NOT NULL,
  new_name       TEXT NOT NULL,
  new_class      "AccountMainClass" NOT NULL,
  new_sub_item   "IncomeStatementSubItem"
);

INSERT INTO "_default_group_split" VALUES
  -- 5. Materiaalit ja palvelut
  ('Materiaalit ja palvelut', 'MATERIALS_AND_SERVICES', '4000', 'Ostot tilikauden aikana', 'MATERIALS_AND_SERVICES', 'PURCHASES'),
  ('Materiaalit ja palvelut', 'MATERIALS_AND_SERVICES', '4400', 'Varastojen muutos', 'MATERIALS_AND_SERVICES', 'CHANGE_IN_INVENTORIES'),
  ('Materiaalit ja palvelut', 'MATERIALS_AND_SERVICES', '4500', 'Ulkopuoliset palvelut', 'MATERIALS_AND_SERVICES', 'EXTERNAL_SERVICES'),
  -- 6. Henkilöstökulut
  ('Henkilöstökulut', 'PERSONNEL_EXPENSES', '5000', 'Palkat ja palkkiot', 'PERSONNEL_EXPENSES', 'WAGES_AND_SALARIES'),
  ('Henkilöstökulut', 'PERSONNEL_EXPENSES', '5100', 'Eläkekulut', 'PERSONNEL_EXPENSES', 'PENSION_EXPENSES'),
  ('Henkilöstökulut', 'PERSONNEL_EXPENSES', '5200', 'Muut henkilösivukulut', 'PERSONNEL_EXPENSES', 'OTHER_SOCIAL_SECURITY_EXPENSES'),
  -- 7. Poistot ja arvonalentumiset
  ('Poistot ja arvonalentumiset', 'DEPRECIATION', '6800', 'Suunnitelman mukaiset poistot', 'DEPRECIATION', 'PLANNED_DEPRECIATION'),
  -- 10. Rahoitustuotot ja -kulut
  ('Rahoitustuotot ja -kulut', 'FINANCIAL_INCOME_AND_EXPENSES', '8000', 'Muut korko- ja rahoitustuotot', 'FINANCIAL_INCOME_AND_EXPENSES', 'OTHER_INTEREST_AND_FINANCIAL_INCOME'),
  ('Rahoitustuotot ja -kulut', 'FINANCIAL_INCOME_AND_EXPENSES', '8100', 'Muut korko- ja rahoitustuotot', 'FINANCIAL_INCOME_AND_EXPENSES', 'OTHER_INTEREST_AND_FINANCIAL_INCOME'),
  ('Rahoitustuotot ja -kulut', 'FINANCIAL_INCOME_AND_EXPENSES', '8200', 'Korkokulut ja muut rahoituskulut', 'FINANCIAL_INCOME_AND_EXPENSES', 'INTEREST_AND_OTHER_FINANCIAL_EXPENSES'),
  ('Rahoitustuotot ja -kulut', 'FINANCIAL_INCOME_AND_EXPENSES', '8300', 'Korkokulut ja muut rahoituskulut', 'FINANCIAL_INCOME_AND_EXPENSES', 'INTEREST_AND_OTHER_FINANCIAL_EXPENSES'),
  -- 12.-14. The old "Tilinpäätössiirrot ja verot" group; the previous
  -- migration renamed its class APPROPRIATIONS_AND_TAXES -> APPROPRIATIONS.
  -- The two tax items have no sub-items, only their own main class.
  ('Tilinpäätössiirrot ja verot', 'APPROPRIATIONS', '9000', 'Poistoeron muutos', 'APPROPRIATIONS', 'CHANGE_IN_DEPRECIATION_DIFFERENCE'),
  ('Tilinpäätössiirrot ja verot', 'APPROPRIATIONS', '9200', 'Tuloverot', 'INCOME_TAXES', NULL),
  ('Tilinpäätössiirrot ja verot', 'APPROPRIATIONS', '9300', 'Muut välittömät verot', 'OTHER_DIRECT_TAXES', NULL);

-- 1. Create the target groups a company needs and doesn't have. A company
--    that already uses the name for something else keeps its group untouched
--    (names are unique per company); step 2 then simply finds no target.
INSERT INTO "AccountGroup"
  ("id", "name", "mainClass", "incomeStatementSubItem", "companyId", "chartOfAccountsId", "updatedAt")
SELECT gen_random_uuid()::text, needed.new_name, needed.new_class, needed.new_sub_item,
       needed."companyId", needed."chartOfAccountsId", CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT m.new_name, m.new_class, m.new_sub_item, g."companyId", g."chartOfAccountsId"
  FROM "_default_group_split" m
  JOIN "AccountGroup" g
    ON g."name" = m.old_name AND g."mainClass" = m.old_class AND g."incomeStatementSubItem" IS NULL
  JOIN "Account" a ON a."accountGroupId" = g."id" AND a."number" = m.account_number
) needed
WHERE NOT EXISTS (
  SELECT 1 FROM "AccountGroup" x
  WHERE x."companyId" = needed."companyId" AND x."name" = needed.new_name
);

-- 2. Every account to move, with its old and new group. The target must
--    match on class and sub-item too, not just name, so an account is never
--    moved into an unrelated group that happens to share the name.
CREATE TEMP TABLE "_account_moves" AS
SELECT a."id" AS account_id, g."id" AS old_group_id, n."id" AS new_group_id
FROM "_default_group_split" m
JOIN "AccountGroup" g
  ON g."name" = m.old_name AND g."mainClass" = m.old_class AND g."incomeStatementSubItem" IS NULL
JOIN "Account" a ON a."accountGroupId" = g."id" AND a."number" = m.account_number
JOIN "AccountGroup" n
  ON n."companyId" = g."companyId"
 AND n."name" = m.new_name
 AND n."mainClass" = m.new_class
 AND n."incomeStatementSubItem" IS NOT DISTINCT FROM m.new_sub_item;

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
