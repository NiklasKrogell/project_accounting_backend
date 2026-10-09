import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import type { Prisma, Role, User } from '../generated/prisma/client';

const INVITER_SELECT = { select: { firstName: true, lastName: true } } as const;

const INBOX_INCLUDE = {
  company: { select: { name: true, businessId: true } },
  invitedBy: INVITER_SELECT,
} as const;

const COMPANY_INCLUDE = {
  user: { select: { firstName: true, lastName: true, email: true } },
  invitedBy: INVITER_SELECT,
} as const;

type InboxRow = Prisma.CompanyInvitationGetPayload<{ include: typeof INBOX_INCLUDE }>;
type CompanyRow = Prisma.CompanyInvitationGetPayload<{ include: typeof COMPANY_INCLUDE }>;

// Null once the administrator who sent the invitation no longer has an account.
function inviterName(inviter: { firstName: string; lastName: string } | null) {
  return inviter ? `${inviter.firstName} ${inviter.lastName}` : null;
}

// An invitation as the invited user's inbox shows it. The business ID and the
// inviter are there so the user can tell who is really asking.
function serializeForInbox(invitation: InboxRow) {
  return {
    id: invitation.id,
    companyId: invitation.companyId,
    companyName: invitation.company.name,
    businessId: invitation.company.businessId,
    role: invitation.role,
    isAdmin: invitation.isAdmin,
    invitedBy: inviterName(invitation.invitedBy),
    createdAt: invitation.createdAt,
  };
}

// An invitation as the company's "users and roles" settings show it.
function serializeForCompany(invitation: CompanyRow) {
  return {
    id: invitation.id,
    userId: invitation.userId,
    firstName: invitation.user.firstName,
    lastName: invitation.user.lastName,
    email: invitation.user.email,
    role: invitation.role,
    isAdmin: invitation.isAdmin,
    invitedBy: inviterName(invitation.invitedBy),
    createdAt: invitation.createdAt,
  };
}

// Invitations for users who already have an account to join a company. The
// invited user answers in their inbox: accepting makes them a member with the
// role and administrator flag the invitation carries, declining deletes it. A
// row exists only while the invitation is pending, so there is nothing to
// expire or to show afterwards.
export const companyInvitationService = {
  // Invites `user` to the company. Called by companyUserService.create for an
  // email that already has an account.
  async create(
    companyId: string,
    invitedById: string,
    user: User,
    access: { role: Role; isAdmin: boolean },
  ) {
    const member = await prisma.companyUser.findUnique({
      where: { userId_companyId: { userId: user.id, companyId } },
    });
    if (member) throw AppError.conflict('That user is already a member of this company');
    // An account still on its temporary password is in the hands of the
    // company that created it as much as its user's: that company's
    // administrator knows the password, or can issue a new one. Inviting it
    // would let them accept as the user and open this company's books.
    if (user.mustChangePassword) {
      throw AppError.conflict('That account has not been taken into use by its user yet');
    }
    const pending = await prisma.companyInvitation.findUnique({
      where: { userId_companyId: { userId: user.id, companyId } },
    });
    if (pending) throw AppError.conflict('That user has already been invited to this company');

    const invitation = await prisma.companyInvitation.create({
      data: { ...access, userId: user.id, companyId, invitedById },
      include: COMPANY_INCLUDE,
    });
    return serializeForCompany(invitation);
  },

  // --- The invited user's side: their inbox ---

  async listForUser(userId: string) {
    const invitations = await prisma.companyInvitation.findMany({
      where: { userId },
      include: INBOX_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return invitations.map(serializeForInbox);
  },

  // Makes the user a member of the inviting company. A session that has no
  // active company starts working in it; one that has stays where it is, and
  // the new company is in the switcher.
  async accept(userId: string, sessionId: string, invitationId: string) {
    return prisma.$transaction(async (tx) => {
      const invitation = await tx.companyInvitation.findFirst({
        where: { id: invitationId, userId },
      });
      if (!invitation) throw AppError.notFound('Invitation not found');
      // The count guards against the invitation being accepted twice at once,
      // or cancelled in between.
      const { count } = await tx.companyInvitation.deleteMany({
        where: { id: invitationId, userId },
      });
      if (count === 0) throw AppError.notFound('Invitation not found');

      const { companyId, role, isAdmin } = invitation;
      await tx.companyUser.create({ data: { userId, companyId, role, isAdmin } });
      await tx.session.updateMany({
        where: { id: sessionId, activeCompanyId: null },
        data: { activeCompanyId: companyId },
      });
      return { companyId };
    });
  },

  async decline(userId: string, invitationId: string): Promise<void> {
    const { count } = await prisma.companyInvitation.deleteMany({
      where: { id: invitationId, userId },
    });
    if (count === 0) throw AppError.notFound('Invitation not found');
  },

  // --- The inviting company's side: its "users and roles" settings ---

  async listForCompany(companyId: string) {
    const invitations = await prisma.companyInvitation.findMany({
      where: { companyId },
      include: COMPANY_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return invitations.map(serializeForCompany);
  },

  // Takes an invitation back before it has been answered.
  async cancel(companyId: string, invitationId: string): Promise<void> {
    const { count } = await prisma.companyInvitation.deleteMany({
      where: { id: invitationId, companyId },
    });
    if (count === 0) throw AppError.notFound('Invitation not found');
  },
};
