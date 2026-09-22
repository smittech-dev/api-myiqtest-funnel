import type { EmailTemplate, EmailTemplateContext } from '../email.types.js';
import type { RecordField } from '../layout.js';
import {
  escapeHtml,
  panel,
  paragraph,
  recordRow,
  renderLayout,
  ruleNote,
  sectionHeading
} from '../layout.js';

/**
 * The contact-form notification — the one email in the registry addressed to
 * us rather than to a customer.
 *
 * It is written in English whatever language the visitor used, because its
 * reader is an operator rather than the person who wrote in. Their language is
 * carried as a field instead, since it is what decides the language of the
 * reply.
 *
 * Every value in it was typed by a stranger into a public, unauthenticated
 * form, so all of it goes through `escapeHtml` before it reaches the markup —
 * including the message body, whose newlines are turned into `<br>` only after
 * escaping. `paragraph({ html: true })` is used here precisely because this
 * file has already done that work; handing it raw input would put a submitter
 * in charge of the HTML of our own inbox.
 */

/** Readable labels for the funnel's topic keys; unknown keys pass through. */
const TOPIC_LABELS: Record<string, string> = {
  billing: 'Billing or refunds',
  results: 'Results',
  technical: 'Something is broken',
  press: 'Press or partnerships',
  other: 'Something else'
};

export function contactTopicLabel(topic: string): string {
  return TOPIC_LABELS[topic] ?? topic;
}

/** Escaped first, then given its line breaks back. */
function messageBlock(message: string): string {
  return escapeHtml(message).replace(/\r?\n/g, '<br>');
}

export const contactTemplates: EmailTemplate[] = [
  {
    id: 'contact_inquiry_admin',
    name: 'Contact form — admin notification',
    description:
      'Sent to CONTACT_ADMIN_EMAIL when someone submits the funnel contact form. Internal; never sent to a customer.',
    category: 'transactional',
    params: [
      'contact_id',
      'contact_name',
      'contact_email',
      'contact_topic',
      'contact_message',
      'contact_language',
      'contact_submitted_at'
    ],
    // Both languages carry the same English line: the recipient is an operator,
    // and the subject has to be scannable in an inbox that holds every other
    // notification too.
    subject: {
      en: 'New contact inquiry from {{contact_name}} ({{contact_topic}})',
      ja: 'New contact inquiry from {{contact_name}} ({{contact_topic}})'
    },
    render: (ctx: EmailTemplateContext): string => {
      const language = 'en' as const;

      const name = ctx.contact_name ?? 'Someone';
      const email = ctx.contact_email ?? '';

      const reference: RecordField[] = [
        { label: 'Language', value: (ctx.contact_language ?? '').toUpperCase() || '—' },
        { label: 'Received', value: ctx.contact_submitted_at ?? '—' }
      ];

      return renderLayout({
        language,
        mastheadTag: 'Contact form',
        previewText: (ctx.contact_message ?? '').slice(0, 120),
        eyebrow: 'New inquiry',
        // The layout escapes `headline`, `footnote` and `footerNote` itself —
        // escaping here as well would show the visitor `&amp;` in their own name.
        headline: name + ' wrote in',
        body:
          paragraph(
            'A new message arrived through the contact form on the funnel. Reply to the address below — it is the one they gave.'
          ) +
          ruleNote(
            language,
            'Reply to <a href="mailto:' +
              escapeHtml(email) +
              '" style="color:#b93c2a;">' +
              escapeHtml(email) +
              '</a>'
          ),
        sections: [
          {
            html:
              sectionHeading(language, 'Message', contactTopicLabel(ctx.contact_topic ?? 'other')) +
              panel(paragraph(messageBlock(ctx.contact_message ?? ''), { html: true }), 'cream'),
            gap: 26
          },
          {
            html: recordRow(language, [
              { label: 'From', value: name },
              { label: 'Email', value: email }
            ])
          },
          { html: recordRow(language, reference), gap: 26 }
        ],
        footnote:
          'Inquiry #' +
          (ctx.contact_id ?? '—') +
          ' — the full history lives in the admin panel, under Contact.',
        footerNote: 'You are receiving this because this address is set as CONTACT_ADMIN_EMAIL.',
        siteUrl: ctx.site_url
      });
    }
  }
];
