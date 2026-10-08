import { prisma } from '../lib/prisma';

// UI languages a user can choose. Mirrors SUPPORTED_LANGUAGES in the UI
// (src/i18n/index.ts); stored as a plain string so adding one needs no migration.
export const SUPPORTED_LANGUAGES = ['fi', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

// Personal preferences of a user. They belong to the user, not to a company,
// so they are the same in every company the user works in.
export interface UserSettings {
  language: Language;
}

export type UserSettingsPatch = { [K in keyof UserSettings]?: UserSettings[K] | undefined };

// What a user who has never saved anything gets. Keep in step with the column
// defaults on the UserSettings model.
export const DEFAULT_USER_SETTINGS: UserSettings = { language: 'fi' };

function isLanguage(value: string): value is Language {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

function toUserSettings(row: { language: string } | null): UserSettings {
  if (!row) return DEFAULT_USER_SETTINGS;
  return {
    // A language dropped from SUPPORTED_LANGUAGES falls back to the default.
    language: isLanguage(row.language) ? row.language : DEFAULT_USER_SETTINGS.language,
  };
}

export const userSettingsService = {
  // The settings row is created lazily, so a missing row means all defaults.
  async get(userId: string): Promise<UserSettings> {
    const row = await prisma.userSettings.findUnique({ where: { userId } });
    return toUserSettings(row);
  },

  // Partial update: only the given settings change.
  async update(userId: string, patch: UserSettingsPatch): Promise<UserSettings> {
    const data = {
      ...(patch.language !== undefined && { language: patch.language }),
    };
    const row = await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return toUserSettings(row);
  },
};
