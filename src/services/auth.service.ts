import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/AppError';
import { mailer } from '../lib/mailer';
import {
  createSession,
  deleteAllSessionsForUser,
  hashToken,
} from '../lib/session';
import { userSettingsService } from './user-settings.service';
import type { TokenPurpose, User } from '../generated/prisma/client';

const TOKEN_TTL_MS = 60 * 60 * 1000; // one-time tokens live 1 hour

// Constant hash verified against for unknown emails so login timing does not
// reveal whether an account exists.
const dummyHashPromise = argon2.hash('dummy-password-for-timing-only');

function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

// Public shape of a user — never expose password_hash.
export function sanitizeUser(user: User) {
  const { password_hash: _password_hash, ...safe } = user;
  return safe;
}

export interface SignupInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  companyName: string;
  businessId: string;
  billingEmail: string;
  billingAddress: string;
  billingCity: string;
  billingPostalCode: string;
  billingCountry: string;
  phone?: string | undefined;
}

export const authService = {
  async signup(input: SignupInput) {
    const email = input.email.toLowerCase();
    const password_hash = await hashPassword(input.password);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw AppError.conflict('An account with that email already exists');
    }

    const { user, company } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          password_hash,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone ?? null,
        },
      });
      const company = await tx.company.create({
        data: {
          name: input.companyName,
          businessId: input.businessId,
          billingEmail: input.billingEmail,
          billingAddress: input.billingAddress,
          billingCity: input.billingCity,
          billingPostalCode: input.billingPostalCode,
          billingCountry: input.billingCountry,
        }, // subscriptionStatus defaults to PENDING_PAYMENT
      });
      await tx.companyUser.create({
        data: { userId: user.id, companyId: company.id, role: 'ADMIN', isAdmin: true },
      });
      await tx.chartOfAccounts.create({ data: { companyId: company.id } });
      return { user, company };
    });

    const sessionToken = await createSession(user.id, company.id);
    await this.issueVerificationEmail(user);

    return { user, company, sessionToken };
  },

  async login(email: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { memberships: { orderBy: { createdAt: 'desc' } } },
    });

    if (!user) {
      // Burn comparable time as a real verification, then fail generically.
      await argon2.verify(await dummyHashPromise, password).catch(() => {});
      throw new AppError(401, 'Invalid email or password');
    }

    const valid = await argon2.verify(user.password_hash, password);
    if (!valid) {
      throw new AppError(401, 'Invalid email or password');
    }

    const activeCompanyId = user.memberships[0]?.companyId ?? null;
    const sessionToken = await createSession(user.id, activeCompanyId);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { lastLogged: new Date() },
    });

    return { user: updated, sessionToken };
  },

  async switchCompany(userId: string, sessionId: string, companyId: string) {
    const membership = await prisma.companyUser.findUnique({
      where: { userId_companyId: { userId, companyId } },
      include: { company: true },
    });
    if (!membership) {
      throw new AppError(403, 'You are not a member of that company');
    }
    await prisma.session.update({
      where: { id: sessionId },
      data: { activeCompanyId: companyId },
    });
    return membership;
  },

  async me(userId: string, activeCompanyId: string | null) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: { include: { company: true }, orderBy: { createdAt: 'asc' } } },
    });
    return {
      user: sanitizeUser(user),
      // Sent along so the UI can apply them (e.g. the language) at boot.
      settings: await userSettingsService.get(userId),
      memberships: user.memberships.map((m) => ({
        companyId: m.companyId,
        companyName: m.company.name,
        role: m.role,
        isAdmin: m.isAdmin,
        subscriptionStatus: m.company.subscriptionStatus,
        subscriptionEndsAt: m.company.subscriptionEndsAt,
      })),
      activeCompanyId,
    };
  },

  // --- one-time tokens ---

  async issueToken(userId: string, purpose: TokenPurpose): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    await prisma.verificationToken.create({
      data: {
        tokenHash: hashToken(raw),
        userId,
        purpose,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });
    return raw;
  },

  async consumeToken(raw: string, purpose: TokenPurpose) {
    const token = await prisma.verificationToken.findUnique({
      where: { tokenHash: hashToken(raw) },
    });
    if (!token || token.purpose !== purpose || token.expiresAt.getTime() <= Date.now()) {
      throw AppError.badRequest('Invalid or expired token');
    }
    await prisma.verificationToken.delete({ where: { id: token.id } });
    return token;
  },

  async issueVerificationEmail(user: User): Promise<void> {
    const raw = await this.issueToken(user.id, 'EMAIL_VERIFICATION');
    await mailer.send({
      to: user.email,
      subject: 'Verify your email',
      text: `Verify your email by POSTing this token to /api/auth/verify-email: ${raw}`,
    });
  },

  async verifyEmail(raw: string): Promise<void> {
    const token = await this.consumeToken(raw, 'EMAIL_VERIFICATION');
    await prisma.user.update({
      where: { id: token.userId },
      data: { emailVerifiedAt: new Date() },
    });
  },

  async forgotPassword(email: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Always succeed from the caller's perspective — no account enumeration.
    if (!user) return;
    const raw = await this.issueToken(user.id, 'PASSWORD_RESET');
    await mailer.send({
      to: user.email,
      subject: 'Reset your password',
      text: `Reset your password by POSTing this token with a new password to /api/auth/reset-password: ${raw}`,
    });
  },

  async resetPassword(raw: string, newPassword: string): Promise<void> {
    const token = await this.consumeToken(raw, 'PASSWORD_RESET');
    const password_hash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: token.userId }, data: { password_hash } });
    // A password reset means the credentials may have been compromised:
    // invalidate every existing session.
    await deleteAllSessionsForUser(token.userId);
  },
};
