import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { acquireMembersLock } from '../lib/companyLock';
import { generateTemporaryPassword, hashPassword } from '../lib/password';
import { assignableRoles, canManageMember } from '../lib/roles';
import { deleteAllSessionsForUser } from '../lib/session';
import { companyInvitationService } from './company-invitation.service';
import type { Prisma, Role } from '../generated/prisma/client';

export interface CreateCompanyUserInput {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  isAdmin?: boolean | undefined;
}

export interface CompanyUserPatch {
  role?: Role | undefined;
  isAdmin?: boolean | undefined;
}

const MEMBER_INCLUDE = {
  user: { select: { firstName: true, lastName: true, email: true, mustChangePassword: true } },
} as const;

type MemberRow = Prisma.CompanyUserGetPayload<{ include: typeof MEMBER_INCLUDE }>;

// A member of a company as the "users and roles" settings show them.
function serializeMember(member: MemberRow) {
  return {
    userId: member.userId,
    firstName: member.user.firstName,
    lastName: member.user.lastName,
    email: member.user.email,
    role: member.role,
    isAdmin: member.isAdmin,
    joinedAt: member.createdAt,
    // Still on the temporary password the account was created with.
    pendingFirstLogin: member.user.mustChangePassword,
  };
}

function findMember(tx: Prisma.TransactionClient, companyId: string, userId: string) {
  return tx.companyUser.findUnique({
    where: { userId_companyId: { userId, companyId } },
    include: MEMBER_INCLUDE,
  });
}

// The members of a company: who they are, their accounting role and whether
// they are company administrators. Who may do what is decided by src/lib/roles
// (roles) and CompanyUser.isAdmin (adding and removing people); the routes
// check the latter, the role rules are applied here.
export const companyUserService = {
  async list(companyId: string) {
    const members = await prisma.companyUser.findMany({
      where: { companyId },
      include: MEMBER_INCLUDE,
      orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }, { createdAt: 'asc' }],
    });
    return members.map(serializeMember);
  },

  // Gives a person access to the company. Someone without an account gets one
  // with a temporary password, returned here once for the administrator to
  // hand over and never stored in the clear, and is a member at once: the
  // account exists only because of this company. Someone who already has an
  // account (users are shared between companies) is not made a member but
  // invited, with the role and administrator flag given here, and decides for
  // themselves in their inbox (companyInvitationService). Exactly one of
  // `member` and `invitation` is returned.
  async create(companyId: string, actorUserId: string, input: CreateCompanyUserInput) {
    const email = input.email.toLowerCase();
    const access = { role: input.role, isAdmin: input.isAdmin ?? false };
    const membership = { companyId, ...access };

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      const invitation = await companyInvitationService.create(
        companyId,
        actorUserId,
        existing,
        access,
      );
      return { member: null, temporaryPassword: null, invitation };
    }

    const temporaryPassword = generateTemporaryPassword();
    const password_hash = await hashPassword(temporaryPassword);
    const member = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password_hash,
          mustChangePassword: true,
          firstName: input.firstName,
          lastName: input.lastName,
        },
      });
      return tx.companyUser.create({
        data: { ...membership, userId: user.id },
        include: MEMBER_INCLUDE,
      });
    });
    return { member: serializeMember(member), temporaryPassword, invitation: null };
  },

  // Changes another member's accounting role and/or company administrator
  // flag. Nobody changes their own, which is also what keeps a company from
  // losing its last administrator: only administrators touch the flag, and the
  // one doing so keeps theirs.
  async update(companyId: string, actorUserId: string, userId: string, patch: CompanyUserPatch) {
    return prisma.$transaction(async (tx) => {
      await acquireMembersLock(tx, companyId);
      const actor = await findMember(tx, companyId, actorUserId);
      if (!actor) throw new AppError(403, 'No active company selected');
      const target = await findMember(tx, companyId, userId);
      if (!target) throw AppError.notFound('User not found');

      if (actor.userId === target.userId) {
        throw new AppError(403, 'You cannot change your own role or administrator rights');
      }
      if (!canManageMember(actor, target)) {
        throw new AppError(403, 'Insufficient role for this action');
      }
      if (patch.isAdmin !== undefined && !actor.isAdmin) {
        throw new AppError(403, 'Company administrator rights required');
      }
      if (patch.role !== undefined && !assignableRoles(actor).includes(patch.role)) {
        throw new AppError(403, 'Insufficient role for this action');
      }

      const updated = await tx.companyUser.update({
        where: { userId_companyId: { userId, companyId } },
        data: {
          ...(patch.role !== undefined && { role: patch.role }),
          ...(patch.isAdmin !== undefined && { isAdmin: patch.isAdmin }),
        },
        include: MEMBER_INCLUDE,
      });
      return serializeMember(updated);
    });
  },

  // Takes a member's access to the company away. The user account itself
  // stays: it may belong to other companies, and the entries the user made
  // keep pointing at it. requireAuth re-checks the membership on every
  // request, so the access ends at once.
  async remove(companyId: string, actorUserId: string, userId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await acquireMembersLock(tx, companyId);
      const actor = await findMember(tx, companyId, actorUserId);
      if (!actor?.isAdmin) throw new AppError(403, 'Company administrator rights required');
      const target = await findMember(tx, companyId, userId);
      if (!target) throw AppError.notFound('User not found');
      if (actor.userId === target.userId) {
        throw new AppError(403, 'You cannot remove your own access');
      }

      await tx.companyUser.delete({ where: { userId_companyId: { userId, companyId } } });
      await tx.session.updateMany({
        where: { userId, activeCompanyId: companyId },
        data: { activeCompanyId: null },
      });
      // The exception: an account created here that was never taken into use
      // and is in no other company is nobody's yet. Deleting it frees the
      // email address, so one entered wrong can be entered again.
      await tx.user.deleteMany({
        where: { id: userId, mustChangePassword: true, memberships: { none: {} } },
      });
    });
  },

  // A new temporary password for a member who lost the first one. Only while
  // the account is still on a temporary password and belongs to this company
  // alone: otherwise it would let one company's administrator into an account
  // that is the user's own, or that opens another company's books.
  async resetTemporaryPassword(companyId: string, userId: string) {
    const target = await prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId } },
      include: { user: { include: { _count: { select: { memberships: true } } } } },
    });
    if (!target) throw AppError.notFound('User not found');
    if (!target.user.mustChangePassword) {
      throw AppError.conflict('This user has already set a password of their own');
    }
    if (target.user._count.memberships > 1) {
      throw AppError.conflict('This user also belongs to another company');
    }

    const temporaryPassword = generateTemporaryPassword();
    const password_hash = await hashPassword(temporaryPassword);
    // Conditions repeated in the write: the user may have set their password,
    // or been added to another company, since the check above.
    const { count } = await prisma.user.updateMany({
      where: { id: userId, mustChangePassword: true, memberships: { every: { companyId } } },
      data: { password_hash },
    });
    if (count === 0) {
      throw AppError.conflict('This user has already set a password of their own');
    }
    // Anyone logged in with the old temporary password is logged out.
    await deleteAllSessionsForUser(userId);
    return { temporaryPassword };
  },
};
