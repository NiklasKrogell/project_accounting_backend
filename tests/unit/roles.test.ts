import { describe, expect, it } from 'vitest';
import type { Role } from '../../src/generated/prisma/client';
import { assignableRoles, canManageMember, ROLE_ORDER } from '../../src/lib/roles';

const member = (role: Role, isAdmin = false, userId = `${role}-${isAdmin}`) => ({
  userId,
  role,
  isAdmin,
});

describe('assignableRoles', () => {
  it('gives a company administrator every role, whatever their own', () => {
    for (const role of ROLE_ORDER) {
      expect(assignableRoles({ role, isAdmin: true })).toEqual(ROLE_ORDER);
    }
  });

  it('gives an accountant or higher the roles below their own', () => {
    expect(assignableRoles({ role: 'ACCOUNTANT', isAdmin: false })).toEqual(['VIEWER', 'LEDGER']);
    expect(assignableRoles({ role: 'ADMIN', isAdmin: false })).toEqual([
      'VIEWER',
      'LEDGER',
      'ACCOUNTANT',
    ]);
  });

  it('gives the roles below accountant none', () => {
    expect(assignableRoles({ role: 'VIEWER', isAdmin: false })).toEqual([]);
    expect(assignableRoles({ role: 'LEDGER', isAdmin: false })).toEqual([]);
  });
});

describe('canManageMember', () => {
  it('lets a company administrator manage everyone but themselves', () => {
    const admin = member('VIEWER', true, 'me');
    for (const role of ROLE_ORDER) {
      expect(canManageMember(admin, member(role))).toBe(true);
      expect(canManageMember(admin, member(role, true))).toBe(true);
    }
    expect(canManageMember(admin, admin)).toBe(false);
  });

  // Rows: the actor's role (not a company administrator). Columns: the
  // target's role (not one either).
  it.each<[Role, Role[]]>([
    ['VIEWER', []],
    ['LEDGER', []],
    ['ACCOUNTANT', ['VIEWER', 'LEDGER']],
    ['ADMIN', ['VIEWER', 'LEDGER', 'ACCOUNTANT']],
  ])('lets %s manage only the members below them', (actorRole, manageable) => {
    const actor = member(actorRole, false, 'me');
    for (const targetRole of ROLE_ORDER) {
      expect(canManageMember(actor, member(targetRole))).toBe(manageable.includes(targetRole));
    }
  });

  it('keeps company administrators out of reach of everyone who is not one', () => {
    for (const actorRole of ROLE_ORDER) {
      expect(canManageMember(member(actorRole, false, 'me'), member('VIEWER', true))).toBe(false);
    }
  });

  it('lets nobody manage themselves', () => {
    for (const role of ROLE_ORDER) {
      expect(canManageMember(member(role, false, 'me'), member('VIEWER', false, 'me'))).toBe(false);
    }
  });
});
