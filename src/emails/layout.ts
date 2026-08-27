import type { EmailLanguage, EmailTemplateContext } from './email.types.js';

/**
 * The shared shell every design renders inside.
 *
 * Email HTML is not web HTML: Outlook still lays tables out with Word, Gmail
 * strips <style> blocks in some contexts, and no two clients agree on flexbox.
 * So this is table-based, 600px wide, with every style inlined — deliberately
 * old-fashioned, because that is what renders the same in twenty clients.
 */

const BRAND = '#4f46e5';
const INK = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const CANVAS = '#f4f4f7';

const FONT_STACK: Record<EmailLanguage, string> = {
  // Japanese needs its own stack: a Latin-first list falls back to a font with
  // no kana, and the whole message renders in the client's default serif.
  ja: "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',Meiryo,'MS PGothic',sans-serif",
  en: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
};

/** Escapes text that came from a customer before it lands in HTML. */
export function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Replaces `{{param}}` with its context value.
 *
 * Used for subject lines, and anywhere a design wants to keep a sentence whole
 * rather than splitting it around a variable — which matters more in Japanese,
 * where the variable rarely sits at the same point in the sentence.
 *
 * An unknown placeholder resolves to an empty string, so a typo shows as a gap
 * rather than shipping `{{frist_name}}` to a customer.
 */
export function interpolate(text: string, ctx: Partial<EmailTemplateContext>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const value = (ctx as Record<string, unknown>)[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

/**
 * The same context with every value HTML-escaped.
 *
 * Interpolating into a slot that is injected as HTML (a body paragraph) has to
 * escape first; interpolating into a slot the layout escapes anyway (headline,
 * CTA) must not, or a customer sees `O&#39;Brien`. Designs pick the right one
 * per slot — this builds the escaped half.
 */
export function escapeContext(ctx: EmailTemplateContext): Record<string, string> {
  const escaped: Record<string, string> = {};

  for (const [key, value] of Object.entries(ctx)) {
    escaped[key] = escapeHtml(value as string | number | null);
  }

  return escaped;
}

/** One button in the action block. */
export interface EmailAction {
  label: string;
  url: string;
  /**
   * Filled in brand colour rather than outlined. Exactly one action should be
   * primary — two equally weighted buttons ask the reader to make a decision
   * the email has not given them the information to make.
   */
  primary?: boolean;
}

interface LayoutOptions {
  language: EmailLanguage;
  /** Small line above the headline — usually the urgency cue. */
  eyebrow?: string;
  headline: string;
  /** Pre-rendered HTML for the message body. */
  body: string;
  /**
   * The buttons, in reading order.
   *
   * A list rather than a single CTA because the report-ready email genuinely
   * has two destinations — the first-sale report and, when it was bought, the
   * cross-sale one — and collapsing them into one button would mean sending a
   * customer to a page to find the other document themselves.
   */
  actions: EmailAction[];
  /** Rendered discount panel, when the message carries a code. */
  discountBlock?: string;
  /** Small print under the buttons, e.g. an expiry note. */
  footnote?: string;
  siteUrl: string;
  brandName?: string;
}

/** The discount panel: the code itself, large enough to read on a phone. */
export function discountPanel(
  language: EmailLanguage,
  code: string,
  percent: number | null
): string {
  const label =
    language === 'ja'
      ? percent !== null
        ? percent + '% OFF クーポンコード'
        : 'クーポンコード'
      : percent !== null
        ? percent + '% OFF COUPON CODE'
        : 'COUPON CODE';

  const hint =
    language === 'ja'
      ? 'ボタンから進むと、お会計時に自動で適用されます。'
      : 'Use the button below and it is applied automatically at checkout.';

  return [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px;">',
    '<tr>',
    '<td align="center" style="background:#eef2ff;border:1px dashed ' + BRAND + ';border-radius:10px;padding:20px 16px;">',
    '<p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:' + BRAND + ';font-weight:700;">' + escapeHtml(label) + '</p>',
    '<p style="margin:0 0 8px;font-size:30px;line-height:1.1;font-weight:700;color:' + INK + ';letter-spacing:.12em;">' + escapeHtml(code) + '</p>',
    '<p style="margin:0;font-size:12px;color:' + MUTED + ';">' + escapeHtml(hint) + '</p>',
    '</td>',
    '</tr>',
    '</table>'
  ].join('');
}

/**
 * The button block.
 *
 * Each button is its own single-cell table stacked on the next, rather than
 * buttons sitting side by side in one row. Outlook lays tables out with Word
 * and will not shrink a two-column row on a narrow screen, so a side-by-side
 * pair reliably overflows on a phone — where most of these are opened. Stacked
 * is less pretty and always readable.
 */
function renderActions(actions: EmailAction[], font: string): string {
  if (actions.length === 0) return '';

  return actions
    .map((action) => {
      const filled = action.primary === true;

      const cell = filled
        ? 'background:' + BRAND + ';border-radius:8px;'
        : 'background:#ffffff;border:2px solid ' + BRAND + ';border-radius:8px;';

      const text = filled ? '#ffffff' : BRAND;

      return [
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 10px;">',
        '<tr><td align="center" style="' + cell + '">',
        '<a href="' + escapeHtml(action.url) + '" style="display:inline-block;padding:14px 34px;font-family:' + font + ';font-size:16px;font-weight:700;color:' + text + ';text-decoration:none;">' + escapeHtml(action.label) + '</a>',
        '</td></tr>',
        '</table>'
      ].join('');
    })
    .join('');
}

/** Wraps a design's body in the branded shell. */
export function renderLayout(options: LayoutOptions): string {
  const {
    language,
    eyebrow,
    headline,
    body,
    actions,
    discountBlock = '',
    footnote,
    siteUrl,
    brandName = 'MyIQTest'
  } = options;

  const font = FONT_STACK[language];
  const receivingNote =
    language === 'ja'
      ? 'このメールは、IQテストを受験された方にお送りしています。'
      : 'You are receiving this because you took our IQ test.';

  const eyebrowRow = eyebrow
    ? '<p style="margin:0 0 10px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:' +
      BRAND +
      ';">' +
      escapeHtml(eyebrow) +
      '</p>'
    : '';

  const footnoteRow = footnote
    ? '<tr><td align="center" style="padding:14px 34px 0;font-family:' +
      font +
      ';font-size:12px;line-height:1.6;color:' +
      MUTED +
      ';">' +
      escapeHtml(footnote) +
      '</td></tr>'
    : '';

  return [
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">',
    '<html xmlns="http://www.w3.org/1999/xhtml" lang="' + language + '">',
    '<head>',
    '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="x-apple-disable-message-reformatting" />',
    '<title>' + escapeHtml(headline) + '</title>',
    '</head>',
    '<body style="margin:0;padding:0;background:' + CANVAS + ';">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + CANVAS + ';">',
    '<tr><td align="center" style="padding:32px 16px;">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ' + BORDER + ';">',

    // Header
    '<tr><td align="center" style="background:' + BRAND + ';padding:22px 24px;">',
    '<a href="' + escapeHtml(siteUrl) + '" style="font-family:' + font + ';font-size:18px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:.02em;">' + escapeHtml(brandName) + '</a>',
    '</td></tr>',

    // Headline + body
    '<tr><td style="padding:34px 34px 6px;font-family:' + font + ';">',
    eyebrowRow,
    '<h1 style="margin:0 0 18px;font-size:23px;line-height:1.4;font-weight:700;color:' + INK + ';">' + escapeHtml(headline) + '</h1>',
    '<div style="font-size:15px;line-height:1.8;color:#374151;">' + body + '</div>',
    '</td></tr>',

    // Discount panel
    '<tr><td style="padding:22px 34px 0;font-family:' + font + ';">' + discountBlock + '</td></tr>',

    // Buttons
    '<tr><td align="center" style="padding:0 34px 8px;font-family:' + font + ';">',
    renderActions(actions, font),
    '</td></tr>',

    footnoteRow,

    // Footer
    '<tr><td style="padding:30px 34px 34px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ' + BORDER + ';font-size:0;line-height:0;">&nbsp;</td></tr></table>',
    '<p style="margin:18px 0 0;font-family:' + font + ';font-size:12px;line-height:1.7;color:' + MUTED + ';">',
    escapeHtml(receivingNote),
    '<br />',
    '<a href="' + escapeHtml(siteUrl) + '" style="color:' + MUTED + ';text-decoration:underline;">' + escapeHtml(brandName) + '</a>',
    '</p>',
    '</td></tr>',

    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>'
  ].join('\n');
}

/** A paragraph in the body voice. Content is escaped unless `html` is set. */
export function paragraph(text: string, opts: { html?: boolean } = {}): string {
  return '<p style="margin:0 0 14px;">' + (opts.html ? text : escapeHtml(text)) + '</p>';
}

/** Renders the "your score was N" callout, or nothing when no score is known. */
export function scoreLine(language: EmailLanguage, score: number | null): string {
  if (score === null) return '';

  const label = language === 'ja' ? 'あなたのIQスコア' : 'Your IQ score';

  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">',
    '<tr><td style="background:#f9fafb;border:1px solid ' + BORDER + ';border-radius:8px;padding:12px 18px;">',
    '<span style="font-size:12px;color:' + MUTED + ';">' + escapeHtml(label) + '</span>',
    '<span style="font-size:22px;font-weight:700;color:' + INK + ';padding-left:12px;">' + escapeHtml(score) + '</span>',
    '</td></tr>',
    '</table>'
  ].join('');
}
