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
