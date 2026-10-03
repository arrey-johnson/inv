import { z } from "zod";

/**
 * Environment access in one place.
 *
 * - `publicEnv` is safe for the browser (NEXT_PUBLIC_* only). Next.js inlines these at build
 *   time, so each variable MUST be referenced literally (no dynamic `process.env[key]`).
 * - `getServerEnv()` validates secrets lazily on first use so that `next build` and unit tests
 *   don't require a fully configured environment.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
});

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || undefined,
});

/**
 * DEMO mode: a local file-backed store under `.data/` replaces Supabase so the whole UI (and PDF
 * generation) can be exercised without a project. Opt-in only (`DEMO_MODE=true`) so a
 * misconfigured production deployment can never silently fall back to local files.
 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

/** True when real Supabase credentials are present AND demo mode is not forcing the local store. */
export function isSupabaseActive(): boolean {
  return !isDemoMode() && isSupabaseConfigured();
}

/** True when the browser/anon Supabase credentials are present. */
export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.NEXT_PUBLIC_SUPABASE_URL && publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /** Organization used when a user has no explicit selection (single-company deployment). */
  DEFAULT_ORGANIZATION_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000001"),
  /** HMAC secret for public document links. Generate with `openssl rand -base64 48`. */
  DOCUMENT_LINK_SECRET: z.string().min(32),
  /** Where to read letterhead/stamp from: `storage` (private Supabase bucket) or `local` (assets/branding/source). */
  BRANDING_SOURCE: z.enum(["storage", "local"]).default("local"),
  EMAIL_PROVIDER: z.enum(["none", "resend", "smtp"]).default("none"),
  EMAIL_FROM: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cachedServerEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;
  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    DEFAULT_ORGANIZATION_ID: process.env.DEFAULT_ORGANIZATION_ID || undefined,
    DOCUMENT_LINK_SECRET: process.env.DOCUMENT_LINK_SECRET,
    BRANDING_SOURCE: process.env.BRANDING_SOURCE || undefined,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || undefined,
    EMAIL_FROM: process.env.EMAIL_FROM || undefined,
    RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment: ${issues}. See .env.example.`);
  }
  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}
