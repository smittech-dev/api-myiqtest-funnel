/**
 * The contract every email design is written against.
 *
 * One shape, one set of names. The same object is handed to a design that
 * renders locally and, flattened, to ZeptoMail as `merge_info` when a template
 * is hosted there instead — which is what lets a template move between the two
 * without a code change.
 */

export type EmailLanguage = 'ja' | 'en';

export type EmailTemplateCategory = 'marketing' | 'transactional';

/** The dynamic parameters a design may read. */
export interface EmailTemplateContext {
  /** Given name when the funnel captured one, otherwise null — greet generically. */
  first_name: string | null;
  /**
   * The name as copy should address the reader, already carrying its fallback:
   * `太郎さん` / `あなた` in Japanese, `Taro` / `there` in English.
   *
   * Subject lines use this rather than `first_name` because a subject cannot
   * branch — an anonymous reader would otherwise get "、レポートが…" or
   * ", your report is waiting". Derived by the send path, never stored.
   */
  honorific_name: string;
  email: string;
  language: EmailLanguage;
  /** The score they walked away with, shown to reopen the story. */
  iq_score: number | null;
  discount_code: string | null;
  /** Percentage off, resolved from data/discount-codes.json. */
  discount_percent: number | null;
  /** Deep link back into the funnel, quiz session and discount already attached. */
  cta_url: string;
  /** Funnel origin, for the logo and the footer links. */
  site_url: string;
  /** Hours since the quiz was submitted, for copy that mentions elapsed time. */
  hours_since_quiz: number | null;

  // --- account credentials (welcome email) -------------------------------
  // Only ever populated for the welcome message, and only on the send that
  // creates the password. Nothing reads these back: the plaintext exists for
  // the length of one request and is never stored.

  /** The address the customer signs in with — the same one they took the quiz with. */
  login_email: string | null;
  /** Plaintext, first-and-only delivery. Null when the account already had one. */
  login_password: string | null;
  /** Where those credentials are used. */
  login_url: string | null;
  /** What they are signing in to, e.g. the brain training programme. */
  program_name: string | null;

  // --- changing the email address ----------------------------------------

  /** Where the account is moving to. Shown on both sides of the change. */
  new_email: string | null;
  /** The address it is moving from. */
  old_email: string | null;
  /** Single-use link that completes the change, sent only to the new address. */
  confirm_url: string | null;
  /** How long that link stays valid, for the copy that says so. */
  confirm_expires_hours: number | null;

  // --- order and billing detail (welcome, report-ready) -------------------
  // Shown so the customer can reconcile the email against their bank
  // statement without contacting us.

  /** Human order number, e.g. `myIQ_8421`. */
  order_ref: string | null;
  /** The date the purchase completed, already formatted for the language. */
  order_date: string | null;
  /** The quiz result this all hangs off, for the receipt line. */
  quiz_id: string | null;
  /** What was paid for the certificate, in the currency they paid in. */
  first_sale_amount: string | null;
  /** The career report, when that upsell was bought. Null when it was not. */
  cross_sale_amount: string | null;
  /** The recurring charge, e.g. `¥5,495` — in the currency of their funnel. */
  subscription_price: string | null;
  /**
   * Days between charges, e.g. 28.
   *
   * Stated rather than called "monthly": the cycle drifts through the calendar,
   * and describing thirteen charges a year as twelve is what chargebacks are
   * made of.
   */
  interval_days: number | null;
  /**
   * When a free trial ends, already formatted.
   *
   * Null unless the subscription genuinely carries one, which gates the whole
   * trial paragraph: an email must never announce a trial the customer does not
   * have.
   */
  trial_end: string | null;
  /** Plain-language band for the score, e.g. `Above average`. */
  iq_band: string | null;

  // --- password reset ----------------------------------------------------
  // Only populated for the reset message. Like the welcome password, the token
  // inside `reset_url` is never stored in plaintext — only its hash is — so
  // this link exists for the length of one request and one email.

  /** Where the member sets a new password, token already attached. */
  reset_url: string | null;
  /** How long the link stays valid, for the copy that says so. */
  reset_expires_hours: number | null;

  // --- report links (report-ready email) ---------------------------------

  /** The first-sale report: certificate and detailed analysis. */
  first_sale_report_url: string | null;
  /** The cross-sale report. Null when the upsell was not purchased. */
  cross_sale_report_url: string | null;
}

/** Every context key, as strings — the parameter list a template declares. */
export type EmailTemplateParam = keyof EmailTemplateContext;

/**
 * One entry of the template master.
 *
 * `id` is the stable handle: it is what a marketing step stores, what the send
 * log records, and what `ZEPTOMAIL_TEMPLATE_<ID>` overrides. Renaming a design
 * is safe; changing its id is not.
 */
export interface EmailTemplate {
  id: string;
  /** Shown in the admin template picker. */
  name: string;
  description: string;
  category: EmailTemplateCategory;
  /**
   * The parameters this design actually uses. Declared rather than inferred so
   * the admin panel can show what a template needs, and so a hosted ZeptoMail
   * version receives exactly the same merge fields.
   */
  params: readonly EmailTemplateParam[];
  /** Subject line per language. Supports {{param}} placeholders. */
  subject: Record<EmailLanguage, string>;
  /** Renders the full HTML body. Only called when no hosted template is set. */
  render: (ctx: EmailTemplateContext) => string;
}

/** What the transport hands back, whichever path produced the message. */
export interface RenderedEmail {
  subject: string;
  html: string;
}
