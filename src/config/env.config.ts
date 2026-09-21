import dotenv from 'dotenv';
dotenv.config();

/**
 * Per-template ZeptoMail template keys, read from the environment by
 * convention: `ZEPTOMAIL_TEMPLATE_<TEMPLATE_ID_UPPERCASED>`.
 *
 *   ZEPTOMAIL_TEMPLATE_MARKETING_REMINDER_DAY1=2518b.53a...
 *
 * Setting one makes that template render inside ZeptoMail (the design is
 * maintained in their editor and the app only supplies merge_info); leaving it
 * unset renders the design that ships in src/emails/templates. Both paths use
 * the same template id and the same parameters, so switching is one env var
 * and no code change.
 */
function readZeptoTemplateKeys(): Record<string, string> {
  const prefix = 'ZEPTOMAIL_TEMPLATE_';
  const keys: Record<string, string> = {};

  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith(prefix) || !value) continue;
    keys[name.slice(prefix.length).toLowerCase()] = value.trim();
  }

  return keys;
}

/** Trailing slashes make every `${base}/path` join produce a double slash. */
const withoutTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

/**
 * Where the quiz funnel is served.
 *
 * This is the site that hosts the test, the result page and the certificate —
 * every link in an email and every document link in the members' area is built
 * from it.
 *
 * `FRONTEND_URL` is the old name and still works, because it is set in
 * deployments that predate this one. It is ambiguous now that there are two
 * front ends: the funnel and the members' app, which has its own
 * `BOOST_APP_URL`.
 */
const funnelUrl = withoutTrailingSlash(
  process.env.FUNNEL_URL || process.env.FRONTEND_URL || 'http://localhost:3000'
);

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  appUrl: process.env.APP_URL || 'http://localhost:5000',
  /** The quiz funnel's origin, already normalised — never has a trailing slash. */
  funnelUrl,
  /** @deprecated Use `funnelUrl`. Kept so nothing outside this file breaks. */
  frontendUrl: funnelUrl,
  
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'iq_funnel',
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    logging: process.env.DB_LOGGING === 'true'
  },
  
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || 'sk_test_mock',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock',
    // Safe to expose to the browser — used by the /app test harness
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || ''
  },

  // Serves the static funnel test harness at /app (development aid, off in production)
  demoEnabled: process.env.DEMO_UI_ENABLED === 'true',

  emailVerification: {
    // Master switch: when off, no Reoon call is made and email_verified stays false
    enabled: process.env.EMAIL_VERIFICATION_ENABLED === 'true',
    apiKey: process.env.REOON_API_KEY || '',
    apiUrl: process.env.REOON_API_URL || 'https://emailverifier.reoon.com/api/v1/verify',
    // 'quick' is fast enough for a request path; 'power' does SMTP checks and is slower
    mode: process.env.REOON_MODE || 'quick',
    // Reoon returns overall_score 0-100; at or above this the address counts as verified
    minScore: parseInt(process.env.EMAIL_VERIFICATION_MIN_SCORE || '80', 10),
    timeoutMs: parseInt(process.env.EMAIL_VERIFICATION_TIMEOUT_MS || '8000', 10)
  },

  // ZeptoMail (Zoho) is the only outbound mail transport. Everything the app
  // sends — marketing sequence and, in time, transactional mail — goes through
  // it. `enabled: false` makes every send a no-op that still writes its
  // tracking row, which is what you want on staging.
  email: {
    enabled: process.env.ZEPTOMAIL_ENABLED === 'true',
    // .com for the global datacenter, .eu for the European one.
    apiUrl: process.env.ZEPTOMAIL_API_URL || 'https://api.zeptomail.com/v1.1/email',
    // The full header value, including the "Zoho-enczapikey " prefix that
    // ZeptoMail prints next to the token in its console.
    token: process.env.ZEPTOMAIL_TOKEN || '',
    fromAddress: process.env.ZEPTOMAIL_FROM_ADDRESS || '',
    fromName: process.env.ZEPTOMAIL_FROM_NAME || 'MyIQTest',
    replyTo: process.env.ZEPTOMAIL_REPLY_TO || '',
    requestTimeoutMs: parseInt(process.env.EMAIL_REQUEST_TIMEOUT_MS || '10000', 10),
    // Renders and logs the message without handing it to the provider. A
    // developer switch, not an operational one.
    dryRun: process.env.EMAIL_DRY_RUN === 'true',
    trackOpens: process.env.ZEPTOMAIL_TRACK_OPENS !== 'false',
    trackClicks: process.env.ZEPTOMAIL_TRACK_CLICKS !== 'false',
    // Optional per-template overrides pointing at templates hosted in
    // ZeptoMail's own editor — see readZeptoTemplateKeys below.
    templateKeys: readZeptoTemplateKeys()
  },

  // Transactional mail — the two messages a paying customer gets: the welcome
  // with their programme credentials, and the report-ready notice.
  transactionalEmail: {
    // Master switch. Off means the sends are skipped and logged, never queued,
    // so turning it on later does not suddenly deliver a backlog of welcomes to
    // customers who bought weeks ago.
    enabled: process.env.TRANSACTIONAL_EMAIL_ENABLED === 'true',
    // How often a failed transactional send is retried by a later trigger.
    maxAttempts: parseInt(process.env.TRANSACTIONAL_EMAIL_MAX_ATTEMPTS || '3', 10)
  },

  // The brain training programme the subscription grants access to. Its sign-in
  // page is what the welcome email's credentials are for.
  brainTraining: {
    name: process.env.BRAIN_TRAINING_NAME || 'Brain Training Program',
    // Falls back to the funnel origin so the welcome email always has somewhere
    // to point, even before the programme has its own URL.
    loginUrl: process.env.BRAIN_TRAINING_LOGIN_URL || ''
  },

  emailMarketing: {
    // Master switch for the schedule. The sequence itself has a second switch
    // in the email_marketing_settings table that an admin can flip from the
    // panel; this one decides whether the cron is registered at all.
    cronEnabled: process.env.EMAIL_MARKETING_ENABLED === 'true',
    cron: process.env.EMAIL_MARKETING_CRON || '*/5 * * * *',
    timezone: process.env.EMAIL_MARKETING_TIMEZONE || 'UTC',
    // A claimed step whose runner died is released after this long, so a crash
    // mid-send costs one delayed email rather than a stuck row.
    stuckClaimMinutes: parseInt(process.env.EMAIL_MARKETING_STUCK_CLAIM_MINUTES || '30', 10)
  },

  subscription: {
    // Master switch: when off, the first sale never starts a subscription
    enabled: process.env.SUBSCRIPTION_ENABLED === 'true',
    // Static Stripe Price ids, one per funnel currency
    priceIdJa: process.env.STRIPE_SUB_PRICE_ID_JA || '',
    priceIdEn: process.env.STRIPE_SUB_PRICE_ID_EN || ''
  },
  
  // Admin panel authentication. Sessions are deliberately long-lived (60 days)
  // so an operator is not re-prompted during normal use; revocation is by
  // flipping the admin user's status to anything other than 'active'.
  admin: {
    jwtSecret: process.env.ADMIN_JWT_SECRET || 'iq_funnel_admin_jwt_dev_secret_change_me',
    jwtExpiresIn: process.env.ADMIN_JWT_EXPIRES_IN || '60d',
    bcryptRounds: parseInt(process.env.ADMIN_BCRYPT_ROUNDS || '10', 10)
  },

  /**
   * Boost My IQ — the members' area of the brain training programme.
   *
   * Its session secret is deliberately separate from the admin one. Sharing a
   * secret between the admin panel and the members' area would make an admin
   * token a valid member token and, far worse, a member token a valid admin
   * one. The `typ` claim is checked on top, so a token minted for one audience
   * is rejected by the other even if the two secrets are ever misconfigured to
   * match.
   */
  boost: {
    jwtSecret: process.env.BOOST_JWT_SECRET || 'boost_member_jwt_dev_secret_change_me',
    /** "Keep me signed in". Sessions without it get `jwtShortExpiresIn`. */
    jwtExpiresIn: process.env.BOOST_JWT_EXPIRES_IN || '60d',
    jwtShortExpiresIn: process.env.BOOST_JWT_SHORT_EXPIRES_IN || '12h',
    /** Where the members' app is served — reset links are built from this. */
    appUrl: process.env.BOOST_APP_URL || 'http://localhost:5173',
    /**
     * Origins allowed to call the members' API with credentials. A credentialed
     * request cannot be answered with `Access-Control-Allow-Origin: *`, so this
     * has to be an explicit list rather than a wildcard.
     */
    appOrigins: (process.env.BOOST_APP_ORIGINS || 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    passwordResetTtlMinutes: parseInt(process.env.BOOST_PASSWORD_RESET_TTL_MINUTES || '60', 10)
  },

  encryptionKey: process.env.ENCRYPTION_KEY || 'iq_funnel_secure_secret_key_2026',
  apiKey: process.env.API_KEY || '',
  
  defaultLanguage: process.env.DEFAULT_LANGUAGE || 'ja',
  defaultCurrency: process.env.DEFAULT_CURRENCY || 'JPY',

  currency: {
    // Master switch for the scheduled exchange-rate refresh
    syncEnabled: process.env.CURRENCY_SYNC_ENABLED === 'true',
    // Default: 00:00 and 12:00 daily (every 12 hours)
    syncCron: process.env.CURRENCY_SYNC_CRON || '0 */12 * * *',
    syncTimezone: process.env.CURRENCY_SYNC_TIMEZONE || 'UTC',
    // Run one refresh immediately at boot instead of waiting for the first tick
    syncOnStartup: process.env.CURRENCY_SYNC_ON_STARTUP === 'true',
    apiUrl: process.env.EXCHANGERATES_API_URL || 'https://api.exchangeratesapi.io/v1',
    apiKey: process.env.EXCHANGERATES_API_KEY || '',
    // Base the provider is asked for, which is not the base we store. The free
    // plan issues EUR quotes only, so the sync fetches EUR and rebases on GBP
    // itself. Set this to GBP only on a plan that genuinely serves other bases.
    providerBase: (process.env.EXCHANGERATES_API_BASE || 'EUR').toUpperCase(),
    requestTimeoutMs: parseInt(process.env.CURRENCY_REQUEST_TIMEOUT_MS || '10000', 10)
  }
};
