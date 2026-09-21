import type { EmailLanguage, EmailTemplateContext } from './email.types.js';

/**
 * Builds a complete `EmailTemplateContext` from the few fields a given email
 * actually knows.
 *
 * Every design shares one context shape, so every send has to supply every
 * field — which, done by hand, means each new parameter added for one email
 * breaks the construction sites of all the others. This is the single place
 * that knows the full shape: callers pass what they have, and everything else
 * comes back null.
 *
 * Null is the right default rather than an empty string, because the designs
 * branch on it — a null `cross_sale_report_url` removes a button, a null
 * `login_password` swaps a credential for a note. An empty string would render
 * those as present but blank.
 */

/** The fields no email can be built without. */
interface RequiredContext {
  email: string;
  language: EmailLanguage;
  site_url: string;
}

export function createEmailContext(
  required: RequiredContext,
  overrides: Partial<EmailTemplateContext> = {}
): EmailTemplateContext {
  return {
    first_name: null,
    honorific_name: honorific(required.language, null),
    email: required.email,
    language: required.language,
    iq_score: null,
    discount_code: null,
    discount_percent: null,
    cta_url: required.site_url,
    site_url: required.site_url,
    hours_since_quiz: null,
    login_email: null,
    login_password: null,
    login_url: null,
    program_name: null,
    reset_url: null,
    reset_expires_hours: null,
    new_email: null,
    old_email: null,
    confirm_url: null,
    confirm_expires_hours: null,
    order_ref: null,
    order_date: null,
    quiz_id: null,
    first_sale_amount: null,
    cross_sale_amount: null,
    subscription_price: null,
    interval_days: null,
    trial_end: null,
    iq_band: null,
    first_sale_report_url: null,
    cross_sale_report_url: null,
    ...overrides
  };
}

/**
 * The name as copy should address the reader, with its fallback already applied.
 *
 * Lives here rather than in each template because subject lines cannot branch:
 * an anonymous reader would otherwise get "、レポートが…" or ", your report is
 * ready". See `EmailTemplateContext.honorific_name`.
 */
export function honorific(language: EmailLanguage, firstName: string | null): string {
  if (language === 'ja') {
    return firstName ? `${firstName}さん` : 'あなた';
  }
  return firstName ?? 'there';
}
