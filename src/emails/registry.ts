import { config } from '../config/env.config.js';
import type {
  EmailLanguage,
  EmailTemplate,
  EmailTemplateCategory,
  EmailTemplateContext,
  RenderedEmail
} from './email.types.js';
import { interpolate } from './layout.js';
import { contactTemplates } from './templates/contact.templates.js';
import { marketingReminderTemplates } from './templates/marketing-reminder.templates.js';
import { transactionalTemplates } from './templates/transactional.templates.js';

/**
 * THE TEMPLATE MASTER.
 *
 * Every email the application can send is listed here exactly once, keyed by a
 * stable template id. Nothing else in the codebase names an email: a marketing
 * step stores `template_id`, the send log records `template_id`, the admin
 * panel offers this list in a dropdown, and the transport looks the design up
 * here. Adding an email — marketing or transactional — means adding a design
 * file and one line to `TEMPLATES` below; nothing downstream changes.
 *
 * Deliberately code and config rather than a database table. These are
 * versioned artefacts: a design belongs in the same commit as the copy it
 * renders and the parameters it expects, and "which templates exist" should not
 * be able to differ between two environments running the same build. What *is*
 * operational — which template a step uses, and whether it is on — lives in
 * the email_marketing_steps table, where an admin can change it without a
 * deploy.
 *
 * Two rendering paths, one id:
 *
 *   - No `ZEPTOMAIL_TEMPLATE_<ID>` env var: the design in src/emails/templates
 *     renders the HTML here, and the transport posts it to /v1.1/email.
 *   - With that env var set: ZeptoMail renders its own hosted template of that
 *     key, and the transport posts the parameters as `merge_info` to
 *     /v1.1/email/template instead.
 *
 * Both paths take the same template id and the same declared parameters, so
 * moving a design into ZeptoMail's editor is one environment variable.
 */
const TEMPLATES: EmailTemplate[] = [
  // The abandoned-checkout ladder.
  ...marketingReminderTemplates,

  // The two messages a paying customer gets. Excluded from the marketing step
  // picker by their `category`, not by living somewhere else — everything the
  // application can send is listed here, once.
  ...transactionalTemplates,

  // The contact-form notification. The only design here whose recipient is an
  // operator rather than a customer, and listed for exactly that reason: "what
  // can this application send" should have one answer.
  ...contactTemplates
];

/** Template id -> definition. Built once; the registry is immutable at runtime. */
const BY_ID: Map<string, EmailTemplate> = new Map(TEMPLATES.map((t) => [t.id, t]));

if (BY_ID.size !== TEMPLATES.length) {
  // A duplicated id would silently shadow a design and send the wrong email, so
  // fail at import rather than at 3am on the first cron tick.
  throw new Error('Duplicate email template id in the template master (src/emails/registry.ts)');
}

/** Every template, in registry order. */
export function listTemplates(category?: EmailTemplateCategory): EmailTemplate[] {
  return category ? TEMPLATES.filter((t) => t.category === category) : [...TEMPLATES];
}

/** One template, or null when the id is unknown. */
export function getTemplate(id: string): EmailTemplate | null {
  return BY_ID.get(id) ?? null;
}

export function templateExists(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * The hosted ZeptoMail template key for an id, when one is configured.
 *
 * Its presence is what decides which of the two rendering paths the transport
 * takes — see the note on TEMPLATES above.
 */
export function providerTemplateKey(id: string): string | null {
  return config.email.templateKeys[id.toLowerCase()] ?? null;
}

/**
 * Renders a template locally: subject with its placeholders filled, and the
 * design's own HTML.
 *
 * Not called when the template is hosted in ZeptoMail — there the provider
 * renders both, from the same context sent as merge_info.
 */
export function renderTemplate(id: string, ctx: EmailTemplateContext): RenderedEmail {
  const template = getTemplate(id);

  if (!template) {
    throw new Error(`Unknown email template "${id}"`);
  }

  const language: EmailLanguage = template.subject[ctx.language] ? ctx.language : 'ja';

  return {
    // Subjects are plain text, so they take the raw context — the client shows
    // an ampersand, not `&amp;`.
    subject: interpolate(template.subject[language], ctx),
    html: template.render({ ...ctx, language })
  };
}

/**
 * The context flattened for ZeptoMail's `merge_info`, restricted to the
 * parameters the template declares.
 *
 * Restricted on purpose: merge_info is the payload of a request to a third
 * party, and a template that never uses `email` has no reason to send it.
 */
export function mergeInfoFor(id: string, ctx: EmailTemplateContext): Record<string, string> {
  const template = getTemplate(id);
  if (!template) return {};

  const info: Record<string, string> = {};

  for (const param of template.params) {
    const value = ctx[param];
    info[param] = value === null || value === undefined ? '' : String(value);
  }

  return info;
}
