import { describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { passwordSchema } from '../../src/lib/apiSchemas';
import { generateTemporaryPassword, hashPassword } from '../../src/lib/password';

describe('generateTemporaryPassword', () => {
  it('makes four groups of four unambiguous characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateTemporaryPassword()).toMatch(/^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){3}$/);
    }
  });

  it('makes a different one every time', () => {
    const made = new Set(Array.from({ length: 200 }, generateTemporaryPassword));
    expect(made.size).toBe(200);
  });

  it('passes the rule for a password a user chooses', () => {
    expect(passwordSchema.safeParse(generateTemporaryPassword()).success).toBe(true);
  });
});

describe('hashPassword', () => {
  it('makes an argon2id hash the password verifies against', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await argon2.verify(hash, 'correct horse battery')).toBe(true);
    expect(await argon2.verify(hash, 'wrong horse battery')).toBe(false);
  });
});
