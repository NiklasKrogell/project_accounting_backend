import { rateLimit } from 'express-rate-limit';

// Brute-force protection on credential and token endpoints. Limits are per IP.
const json429 = { error: { message: 'Too many requests, please try again later' } };

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: json429,
});

export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: json429,
});

// Changing the password asks for the current one, so a stolen session could
// otherwise guess at it.
export const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: json429,
});

// Verification / password-reset token endpoints.
export const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: json429,
});
