/**
 * Centralised configuration.
 *
 * Reads environment variables once at startup.  In production every
 * required variable must be set — the process throws immediately so
 * the deployment fails visibly rather than running with silent defaults.
 */

const IS_PROD = process.env.NODE_ENV === 'production';

function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value) return value;
  if (IS_PROD) throw new Error(`[startup] Missing required environment variable: ${key}`);
  if (fallback !== undefined) return fallback;
  throw new Error(`[startup] Missing environment variable: ${key}`);
}

export const config = {
  // ── Auth ────────────────────────────────────────────────────────────────────
  jwtSecret:      requireEnv('JWT_SECRET', 'dev-secret-change-in-production'),
  jwtExpiresIn:   process.env.JWT_EXPIRES_IN || '8h',
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  omsApiKey:      process.env.OMS_API_KEY,

  // ── Server ──────────────────────────────────────────────────────────────────
  port:    parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  /** Allowed CORS origin(s).  In production set to the deployed frontend URL. */
  corsOrigin: process.env.CORS_ORIGIN || '*',

  // ── Business rules ──────────────────────────────────────────────────────────
  /** Minutes a task lock is held before expiring and reverting to ASSIGNED. */
  LOCK_DURATION_MINUTES: 10,

  /** Hours between automatic retry calls (No Answer / Busy / Switched Off). */
  RETRY_DELAY_HOURS: 4,

  /** Minutes before a follow-up call (CONNECTED_FOLLOW_UP). */
  FOLLOW_UP_DELAY_MINUTES: 30,

  /** Minutes before a payment reminder call (CONNECTED_WILL_PAY). */
  PAYMENT_REMINDER_MINUTES: 120,

  /**
   * Within this window an agent will NOT be assigned another lead that shares
   * the same patient phone number — prevents the patient from being called
   * multiple times in quick succession by the same agent.
   */
  PHONE_DEDUP_WINDOW_MINUTES: 60,

  /** Maximum tasks fetched per redistributePendingTasks call. */
  MAX_REASSIGN_BATCH: 100,

  /** Maximum leads accepted by the bulk-create endpoint. */
  MAX_BULK_EVENTS: 500,
} as const;
