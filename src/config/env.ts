import 'dotenv/config';
import { z } from 'zod';
import { parseTrustProxy } from '../lib/trustProxy';

// Validate and coerce environment variables once at startup. Any missing or
// malformed value fails fast with a readable message instead of surfacing as a
// confusing runtime error deep in the app.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // The reverse proxy in front of the server, if any (src/lib/trustProxy.ts).
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((value, ctx) => {
      try {
        return parseTrustProxy(value);
      } catch (err) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: (err as Error).message });
        return z.NEVER;
      }
    }),
  // Object storage, spoken to over the S3 API (src/lib/objectStorage.ts):
  // Cloudflare R2 in production, the S3Mock container of docker-compose.yml in
  // development. R2 takes 'auto' as its region.
  S3_ENDPOINT: z.string().url('S3_ENDPOINT must be a URL'),
  S3_REGION: z.string().min(1).default('auto'),
  S3_BUCKET: z.string().min(1, 'S3_BUCKET is required'),
  S3_ACCESS_KEY_ID: z.string().min(1, 'S3_ACCESS_KEY_ID is required'),
  S3_SECRET_ACCESS_KEY: z.string().min(1, 'S3_SECRET_ACCESS_KEY is required'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
