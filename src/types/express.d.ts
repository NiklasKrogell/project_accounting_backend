import type { Company, CompanyUser, Session, User } from '../generated/prisma/client';

// Auth context attached by requireAuth. `membership` is the caller's membership
// in the session's active company (with the company loaded) — null when the
// session has no valid active company (e.g. membership was revoked).
export interface AuthContext {
  user: User;
  session: Session;
  membership: (CompanyUser & { company: Company }) | null;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
