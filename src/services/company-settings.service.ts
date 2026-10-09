import type { Prisma } from '../generated/prisma/client';
import { prisma } from '../lib/prisma';

// Settings of a company's books. They belong to the company, not to a user, so
// they are the same for everyone working in it.
export interface CompanySettings {
  // Whether the company is registered for VAT. When it is not, no journal
  // entry line may carry a VAT rate (see journal-entry.service.ts).
  vatRegistered: boolean;
}

export type CompanySettingsPatch = {
  [K in keyof CompanySettings]?: CompanySettings[K] | undefined;
};

// What a company that has never saved anything gets. Keep in step with the
// column defaults on the CompanySettings model.
export const DEFAULT_COMPANY_SETTINGS: CompanySettings = { vatRegistered: true };

function toCompanySettings(row: { vatRegistered: boolean } | null): CompanySettings {
  if (!row) return DEFAULT_COMPANY_SETTINGS;
  return { vatRegistered: row.vatRegistered };
}

export const companySettingsService = {
  // The settings row is created lazily, so a missing row means all defaults.
  // Takes a transaction client so a write can read them consistently.
  async get(
    companyId: string,
    client: Prisma.TransactionClient = prisma,
  ): Promise<CompanySettings> {
    const row = await client.companySettings.findUnique({ where: { companyId } });
    return toCompanySettings(row);
  },

  // Partial update: only the given settings change.
  async update(companyId: string, patch: CompanySettingsPatch): Promise<CompanySettings> {
    const data = {
      ...(patch.vatRegistered !== undefined && { vatRegistered: patch.vatRegistered }),
    };
    const row = await prisma.companySettings.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });
    return toCompanySettings(row);
  },
};
