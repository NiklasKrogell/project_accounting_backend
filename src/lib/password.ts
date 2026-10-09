import { randomInt } from 'node:crypto';
import argon2 from 'argon2';

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

// Letters and digits that can't be mistaken for one another when the password
// is read out or copied by hand (no 0/O, 1/I/L).
const TEMPORARY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUPS = 4;
const GROUP_LENGTH = 4;

// The password of an account a company administrator creates for someone
// else, e.g. 'K7QM-3XPD-9RTW-HV2F' (about 79 bits). The administrator hands it
// over and the user has to replace it at first login (User.mustChangePassword).
export function generateTemporaryPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = '';
    for (let i = 0; i < GROUP_LENGTH; i++) {
      group += TEMPORARY_ALPHABET[randomInt(TEMPORARY_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}
