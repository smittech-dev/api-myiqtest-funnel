import type { EmailLanguage, EmailTemplateContext } from './email.types.js';

/**
 * The shared shell every design renders inside.
 *
 * Built to the reference designs in `docs/email-template-ref/`: a 600px card on
 * a pale blue canvas, navy masthead rule, coral eyebrows, and panels in cream
 * and pale blue.
 *
 * Email HTML is not web HTML. Outlook lays tables out with Word, Gmail strips
 * the `<style>` block in its clipped view, and no client agrees on flexbox. So
 * this is table-based with every style inlined — deliberately old-fashioned,
 * because that is what renders the same in twenty clients. The `<style>` block
 * carries responsive rules only, as progressive enhancement; nothing in it is
 * load-bearing.
 */

/* ── design tokens, from the reference ────────────────────────────────────── */

const CANVAS = '#f2f5f9';
const CARD = '#ffffff';
const NAVY = '#12294a';
const INK = '#101826';
const MUTED = '#5a6779';
const FAINT = '#7d8797';
const PALE = '#a8b0bd';
const CORAL = '#d94f3d';
const CORAL_BTN = '#e8654f';
const LINK = '#b93c2a';
const CREAM = '#f8f6f2';
const PALE_BLUE = '#f1f5fa';
const HAIRLINE = 'rgba(18,41,74,0.12)';

/**
 * Two stacks per language, because the reference sets headings in Sora and body
 * copy in a plain grotesque, and mixing them is most of the look.
 *
 * Japanese needs its own list: a Latin-first stack falls back to a font with no
 * kana, and the whole message renders in the client's default serif. Sora has
 * no Japanese glyphs at all, so the JA display stack names the Gothic faces
 * first and lets weight carry the emphasis instead.
 */
const JA_STACK =
  "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',Meiryo,'MS PGothic',sans-serif";

const DISPLAY: Record<EmailLanguage, string> = {
  en: "'Sora','Helvetica Neue',Helvetica,Arial,sans-serif",
  ja: JA_STACK
};

const BODY: Record<EmailLanguage, string> = {
  en: "'Helvetica Neue',Helvetica,Arial,sans-serif",
  ja: JA_STACK
};

const MONO = "ui-monospace,'SFMono-Regular','Courier New',monospace";

/** The masthead logo, per language. */
const LOGO: Record<EmailLanguage, { src: string; width: number; height: number; alt: string }> = {
  en: { src: 'https://myiq-test.com/logo-en-navy.png', width: 180, height: 33, alt: 'myIQ Test' },
  ja: { src: 'https://myiq-test.com/logo-jp-navy.png', width: 180, height: 35, alt: 'myIQ Test' }
};

/* ── escaping ─────────────────────────────────────────────────────────────── */

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

/* ── building blocks ──────────────────────────────────────────────────────── */

/** One button in the action block. */
export interface EmailAction {
  label: string;
  url: string;
  /**
   * Filled in coral rather than navy. Exactly one action should be primary —
   * two equally weighted buttons ask the reader to make a decision the email
   * has not given them the information to make.
   */
  primary?: boolean;
}

/** A pill button. Bulletproof enough for Outlook without VML. */
export function button(
  language: EmailLanguage,
  label: string,
  url: string,
  opts: { tone?: 'coral' | 'navy' | 'coralDeep'; align?: 'center' | 'left'; size?: 'lg' | 'sm' } = {}
): string {
  const { tone = 'coral', align = 'center', size = 'lg' } = opts;
  const bg = tone === 'navy' ? NAVY : tone === 'coralDeep' ? CORAL : CORAL_BTN;
  const padding = size === 'lg' ? '14px 32px' : '13px 28px';
  const fontSize = size === 'lg' ? '15px' : '14px';

  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn"' +
      (align === 'center' ? ' align="center" style="margin:0 auto;"' : '') +
      '>',
    '<tr>',
    '<td align="center" bgcolor="' + bg + '" style="border-radius:999px;">',
    '<a href="' +
      escapeHtml(url) +
      '" target="_blank" style="display:inline-block; padding:' +
      padding +
      "; font-family:" +
      DISPLAY[language] +
      '; font-size:' +
      fontSize +
      '; line-height:18px; font-weight:bold; color:#ffffff; text-decoration:none; border-radius:999px;">' +
      escapeHtml(label) +
      '</a>',
    '</td>',
    '</tr>',
    '</table>'
  ].join('');
}

/**
 * The navy call-to-action card: a line of promise, then the button.
 *
 * The one block in the design that inverts, which is what makes it the thing
 * the eye lands on after the headline.
 */
export function ctaCard(
  language: EmailLanguage,
  opts: { title: string; label: string; url: string; note?: string; tone?: 'coral' | 'coralDeep' }
): string {
  const noteRow = opts.note
    ? '<p style="margin:16px 0 0 0; font-family:' +
      BODY[language] +
      '; font-size:12px; line-height:19px; color:rgba(255,255,255,0.55);">' +
      escapeHtml(opts.note) +
      '</p>'
    : '';

  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:' +
      NAVY +
      '; border-radius:14px;">',
    '<tr><td align="center" style="padding:30px 24px;">',
    '<p style="margin:0 0 20px 0; font-family:' +
      DISPLAY[language] +
      '; font-size:22px; line-height:30px; font-weight:bold; color:#ffffff;">' +
      escapeHtml(opts.title) +
      '</p>',
    button(language, opts.label, opts.url, { tone: opts.tone ?? 'coral' }),
    noteRow,
    '</td></tr>',
    '</table>'
  ].join('');
}

/** The big score on navy — the report email's centrepiece. */
export function scoreCard(
  language: EmailLanguage,
  opts: { label: string; score: number; band?: string | null }
): string {
  const bandRow = opts.band
    ? '<p style="margin:0; font-family:' +
      BODY[language] +
      '; font-size:13px; line-height:20px; color:' +
      CORAL_BTN +
      ';">' +
      escapeHtml(opts.band) +
      '</p>'
    : '';

  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:' +
      NAVY +
      '; border-radius:14px;">',
    '<tr><td align="center" style="padding:30px 24px 26px 24px;">',
    '<p style="margin:0 0 6px 0; font-family:' +
      DISPLAY[language] +
      '; font-size:10px; line-height:16px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; color:rgba(255,255,255,0.6);">' +
      escapeHtml(opts.label) +
      '</p>',
    '<p class="score-num" style="margin:0 0 4px 0; font-family:' +
      DISPLAY[language] +
      '; font-size:68px; line-height:72px; font-weight:bold; letter-spacing:-2px; color:#ffffff;">' +
      escapeHtml(opts.score) +
      '</p>',
    bandRow,
    '</td></tr>',
    '</table>'
  ].join('');
}

/** A soft panel. `cream` for information, `blue` for anything actionable. */
export function panel(html: string, tone: 'cream' | 'blue' | 'canvas' = 'cream'): string {
  const bg = tone === 'blue' ? PALE_BLUE : tone === 'canvas' ? CANVAS : CREAM;

  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:' +
      bg +
      '; border-radius:14px;">',
    '<tr><td style="padding:24px 24px 26px 24px;">',
    html,
    '</td></tr>',
    '</table>'
  ].join('');
}

/** A panel heading, with optional supporting line. */
export function panelHeading(language: EmailLanguage, title: string, lede?: string): string {
  const ledeRow = lede
    ? '<p style="margin:0 0 18px 0; font-family:' +
      BODY[language] +
      '; font-size:13px; line-height:21px; color:' +
      MUTED +
      ';">' +
      escapeHtml(lede) +
      '</p>'
    : '';

  return (
    '<h3 style="margin:0 0 ' +
    (lede ? '6px' : '10px') +
    ' 0; font-family:' +
    DISPLAY[language] +
    '; font-size:16px; line-height:24px; font-weight:bold; color:' +
    INK +
    ';">' +
    escapeHtml(title) +
    '</h3>' +
    ledeRow
  );
}

export interface NumberedItem {
  title: string;
  body: string;
}

/**
 * The numbered feature list — 01, 02, 03 in coral.
 *
 * Numbers rather than bullets because they imply a set with a size: the reader
 * knows at 01 that there is a finite list, which a dot does not tell them.
 */
export function numberedList(language: EmailLanguage, items: NumberedItem[]): string {
  return items
    .map((item, i) => {
      const last = i === items.length - 1;
      return [
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"' +
          (last ? '' : ' style="margin-bottom:18px;"') +
          '>',
        '<tr>',
        '<td width="34" valign="top" style="font-family:' +
          BODY[language] +
          '; font-size:13px; line-height:22px; font-weight:bold; color:' +
          CORAL +
          ';">' +
          String(i + 1).padStart(2, '0') +
          '</td>',
        '<td valign="top">',
        '<p style="margin:0 0 3px 0; font-family:' +
          DISPLAY[language] +
          '; font-size:15px; line-height:22px; font-weight:bold; color:' +
          INK +
          ';">' +
          escapeHtml(item.title) +
          '</p>',
        '<p style="margin:0; font-family:' +
          BODY[language] +
          '; font-size:13px; line-height:21px; color:' +
          MUTED +
          ';">' +
          escapeHtml(item.body) +
          '</p>',
        '</td>',
        '</tr>',
        '</table>'
      ].join('');
    })
    .join('');
}

/**
 * The credentials block.
 *
 * The password is set in monospace and letter-spaced, because the one thing
 * this block has to survive is being retyped by hand from a phone screen.
 */
export function credentialsPanel(
  language: EmailLanguage,
  opts: { emailLabel: string; email: string; passwordLabel: string; password: string | null; note?: string }
): string {
  const rows: string[] = [
    '<tr><td style="padding:14px 16px ' +
      (opts.password ? '6px' : '14px') +
      ' 16px;">' +
      '<p style="margin:0 0 2px 0; font-family:' +
      BODY[language] +
      '; font-size:10px; line-height:16px; letter-spacing:1.2px; text-transform:uppercase; color:' +
      FAINT +
      ';">' +
      escapeHtml(opts.emailLabel) +
      '</p>' +
      '<p style="margin:0; font-family:' +
      DISPLAY[language] +
      '; font-size:14px; line-height:22px; font-weight:bold; color:' +
      NAVY +
      '; word-break:break-all;">' +
      escapeHtml(opts.email) +
      '</p>' +
      '</td></tr>'
  ];

  if (opts.password) {
    rows.push(
      '<tr><td style="padding:8px 16px 14px 16px;">' +
        '<p style="margin:0 0 2px 0; font-family:' +
        BODY[language] +
        '; font-size:10px; line-height:16px; letter-spacing:1.2px; text-transform:uppercase; color:' +
        FAINT +
        ';">' +
        escapeHtml(opts.passwordLabel) +
        '</p>' +
        '<p style="margin:0; font-family:' +
        MONO +
        '; font-size:15px; line-height:22px; font-weight:bold; letter-spacing:1px; color:' +
        NAVY +
        ';">' +
        escapeHtml(opts.password) +
        '</p>' +
        '</td></tr>'
    );
  } else if (opts.note) {
    rows.push(
      '<tr><td style="padding:0 16px 14px 16px;">' +
        '<p style="margin:0; font-family:' +
        BODY[language] +
        '; font-size:12px; line-height:20px; color:' +
        MUTED +
        ';">' +
        escapeHtml(opts.note) +
        '</p>' +
        '</td></tr>'
    );
  }

  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:' +
      CARD +
      '; border:1px solid ' +
      HAIRLINE +
      '; border-radius:10px;">',
    rows.join(''),
    '</table>'
  ].join('');
}

/** A note set off by a coral rule — for the one caveat that must not be missed. */
export function ruleNote(language: EmailLanguage, html: string): string {
  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-left:3px solid ' +
      CORAL +
      ';">',
    '<tr><td style="padding:2px 0 2px 16px; font-family:' +
      BODY[language] +
      '; font-size:13px; line-height:22px; color:' +
      MUTED +
      ';">',
    html,
    '</td></tr>',
    '</table>'
  ].join('');
}

export interface RecordField {
  label: string;
  value: string;
}

/** The two-up reference row above the footer: order number, date. */
export function recordRow(language: EmailLanguage, fields: RecordField[]): string {
  const cells = fields
    .map((field, i) => {
      const pad = i === 0 ? 'padding:18px 12px 0 0;' : 'padding:18px 0 0 12px;';
      return (
        '<td width="50%" class="stack" style="' +
        pad +
        '">' +
        '<p style="margin:0 0 2px 0; font-family:' +
        BODY[language] +
        '; font-size:10px; line-height:14px; letter-spacing:1.4px; text-transform:uppercase; color:' +
        FAINT +
        ';">' +
        escapeHtml(field.label) +
        '</p>' +
        '<p style="margin:0; font-family:' +
        BODY[language] +
        '; font-size:13px; line-height:20px; font-weight:bold; color:' +
        NAVY +
        ';">' +
        escapeHtml(field.value) +
        '</p>' +
        '</td>'
      );
    })
    .join('');

  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ' +
      HAIRLINE +
      ';">',
    '<tr>' + cells + '</tr>',
    '</table>'
  ].join('');
}

/** The receipt table: a label on the left, an amount on the right. */
export function receipt(
  language: EmailLanguage,
  opts: { eyebrow: string; rows: RecordField[] }
): string {
  const lines = opts.rows
    .map((row, i) => {
      const pad = i === 0 ? '0' : '10px 0 0 0';
      return (
        '<tr>' +
        '<td style="padding:' +
        pad +
        '; font-family:' +
        BODY[language] +
        '; font-size:13px; line-height:22px; color:' +
        MUTED +
        ';">' +
        escapeHtml(row.label) +
        '</td>' +
        '<td align="right" style="padding:' +
        pad +
        '; font-family:' +
        DISPLAY[language] +
        '; font-size:14px; line-height:22px; font-weight:bold; color:' +
        NAVY +
        ';">' +
        escapeHtml(row.value) +
        '</td>' +
        '</tr>'
      );
    })
    .join('');

  return [
    '<p style="margin:0 0 14px 0; font-family:' +
      DISPLAY[language] +
      '; font-size:11px; line-height:16px; font-weight:bold; letter-spacing:1.8px; text-transform:uppercase; color:' +
      CORAL +
      ';">' +
      escapeHtml(opts.eyebrow) +
      '</p>',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">',
    lines,
    '</table>'
  ].join('');
}

/** A section heading in the body flow: coral eyebrow over a dark title. */
export function sectionHeading(language: EmailLanguage, eyebrow: string, title: string): string {
  return (
    '<p style="margin:0 0 4px 0; font-family:' +
    DISPLAY[language] +
    '; font-size:11px; line-height:16px; font-weight:bold; letter-spacing:1.8px; text-transform:uppercase; color:' +
    CORAL +
    ';">' +
    escapeHtml(eyebrow) +
    '</p>' +
    '<h2 style="margin:0 0 22px 0; font-family:' +
    DISPLAY[language] +
    '; font-size:20px; line-height:28px; font-weight:bold; letter-spacing:-0.3px; color:' +
    INK +
    ';">' +
    escapeHtml(title) +
    '</h2>'
  );
}

/** A paragraph in the body voice. Content is escaped unless `html` is set. */
export function paragraph(text: string, opts: { html?: boolean } = {}): string {
  return (
    '<p style="margin:0 0 14px 0; font-size:15px; line-height:26px; color:' +
    MUTED +
    ';">' +
    (opts.html ? text : escapeHtml(text)) +
    '</p>'
  );
}

/** Renders the "your score was N" callout, or nothing when no score is known. */
export function scoreLine(language: EmailLanguage, score: number | null): string {
  if (score === null) return '';

  const label = language === 'ja' ? 'あなたのIQスコア' : 'Your IQ score';

  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;">',
    '<tr><td style="background:' +
      CREAM +
      '; border-radius:10px; padding:12px 18px;">',
    '<span style="font-family:' +
      BODY[language] +
      '; font-size:12px; color:' +
      FAINT +
      ';">' +
      escapeHtml(label) +
      '</span>',
    '<span style="font-family:' +
      DISPLAY[language] +
      '; font-size:22px; font-weight:bold; color:' +
      INK +
      '; padding-left:12px;">' +
      escapeHtml(score) +
      '</span>',
    '</td></tr>',
    '</table>'
  ].join('');
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

  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:' +
      CREAM +
      '; border-radius:14px;">',
    '<tr><td align="center" style="padding:22px 24px;">',
    '<p style="margin:0 0 8px 0; font-family:' +
      DISPLAY[language] +
      '; font-size:11px; line-height:16px; font-weight:bold; letter-spacing:1.8px; text-transform:uppercase; color:' +
      CORAL +
      ';">' +
      escapeHtml(label) +
      '</p>',
    '<p style="margin:0; font-family:' +
      MONO +
      '; font-size:26px; line-height:34px; font-weight:bold; letter-spacing:3px; color:' +
      NAVY +
      ';">' +
      escapeHtml(code) +
      '</p>',
    '</td></tr>',
    '</table>'
  ].join('');
}

/* ── the shell ────────────────────────────────────────────────────────────── */

export interface LayoutSection {
  /** Pre-rendered HTML. Rendered inside the 40px gutter. */
  html: string;
  /** Top padding above this section. Defaults to 32px. */
  gap?: number;
}

interface LayoutOptions {
  language: EmailLanguage;
  /** Small line above the headline — usually the urgency cue. */
  eyebrow?: string;
  headline: string;
  /** Pre-rendered HTML for the message body, directly under the headline. */
  body: string;
  /** Right-hand label in the masthead, e.g. "Report ready". */
  mastheadTag?: string;
  /**
   * The line shown in the inbox list, before the message is opened.
   *
   * Worth setting on every design: left empty, clients pull the first words of
   * the body instead, which is usually the greeting and tells the reader
   * nothing about whether to open it.
   */
  previewText?: string;
  /** Blocks under the body, in order. */
  sections?: LayoutSection[];
  /**
   * The buttons, in reading order.
   *
   * A list rather than a single CTA because the report-ready email genuinely
   * has two destinations — the first-sale report and, when it was bought, the
   * cross-sale one — and collapsing them into one would mean sending a customer
   * to a page to find the other document themselves.
   */
  actions?: EmailAction[];
  /** Rendered discount panel, when the message carries a code. */
  discountBlock?: string;
  /** Small print under the buttons, e.g. an expiry note. */
  footnote?: string;
  /** Replaces the default "you are receiving this because…" line. */
  footerNote?: string;
  /** The address this was sent to, named in the footer so it is verifiable. */
  recipientEmail?: string;
  siteUrl: string;
  brandName?: string;
}

const FOOTER_COPY: Record<EmailLanguage, { receiving: string; questions: string; support: string; privacy: string; terms: string; subscription: string }> = {
  en: {
    receiving: 'You are receiving this because you took the myIQ Test with the email address',
    questions: 'Questions? Write to',
    support: 'and a person will reply.',
    privacy: 'Privacy',
    terms: 'Terms',
    subscription: 'Subscription terms'
  },
  ja: {
    receiving: 'このメールは、次のメールアドレスでmyIQテストを受験された方にお送りしています：',
    questions: 'ご不明な点がございましたら、',
    support: 'までご連絡ください。担当者よりご返信いたします。',
    privacy: 'プライバシーポリシー',
    terms: '利用規約',
    subscription: 'サブスクリプション規約'
  }
};

const SUPPORT_EMAIL = 'support@myiq-test.com';

/** The invisible line clients show beside the subject, plus a spacer. */
function previewBlock(text: string): string {
  // The spacer stops the client pulling body copy in after the preview line.
  const spacer = '&#847;&nbsp;'.repeat(24);

  return (
    '<div style="display:none; font-size:1px; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden; mso-hide:all;">' +
    escapeHtml(text) +
    ' ' +
    spacer +
    '</div>'
  );
}

function renderActions(language: EmailLanguage, actions: EmailAction[]): string {
  return actions
    .map((action) =>
      '<tr><td align="center" style="padding-bottom:10px;">' +
      button(language, action.label, action.url, { tone: action.primary ? 'coral' : 'navy' }) +
      '</td></tr>'
    )
    .join('');
}

function renderFooter(language: EmailLanguage, opts: LayoutOptions): string {
  const copy = FOOTER_COPY[language];
  const body = BODY[language];
  const legalBase = 'https://myiq-test.com/' + language + '/legal/';

  const receiving = opts.footerNote
    ? escapeHtml(opts.footerNote)
    : escapeHtml(copy.receiving) +
      (opts.recipientEmail ? ' ' + escapeHtml(opts.recipientEmail) : '') +
      (language === 'ja' ? '' : '.');

  const legalLink = (slug: string, label: string) =>
    '<a href="' +
    legalBase +
    slug +
    '" target="_blank" style="color:' +
    PALE +
    '; text-decoration:underline;">' +
    escapeHtml(label) +
    '</a>';

  return [
    '<tr><td class="px" style="padding:28px 40px 34px 40px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid ' +
      HAIRLINE +
      ';">',
    '<tr><td style="padding-top:20px;">',
    '<p style="margin:0 0 12px 0; font-family:' +
      body +
      '; font-size:12px; line-height:20px; color:' +
      MUTED +
      ';">' +
      receiving +
      '</p>',
    '<p style="margin:0 0 12px 0; font-family:' +
      body +
      '; font-size:12px; line-height:20px; color:' +
      MUTED +
      ';">' +
      escapeHtml(copy.questions) +
      ' <a href="mailto:' +
      SUPPORT_EMAIL +
      '" style="color:' +
      LINK +
      '; text-decoration:underline;">' +
      SUPPORT_EMAIL +
      '</a> ' +
      escapeHtml(copy.support) +
      '</p>',
    '<p style="margin:0; font-family:' +
      body +
      '; font-size:11px; line-height:18px; color:' +
      PALE +
      ';">' +
      legalLink('privacy', copy.privacy) +
      '&nbsp;&middot;&nbsp;' +
      legalLink('terms', copy.terms) +
      '&nbsp;&middot;&nbsp;' +
      legalLink('subscription', copy.subscription) +
      '</p>',
    '</td></tr>',
    '</table>',
    '</td></tr>'
  ].join('');
}

/** Wraps a design's body in the branded shell. */
export function renderLayout(options: LayoutOptions): string {
  const {
    language,
    eyebrow,
    headline,
    body,
    mastheadTag,
    previewText,
    sections = [],
    actions = [],
    discountBlock = '',
    footnote,
    siteUrl
  } = options;

  const display = DISPLAY[language];
  const bodyFont = BODY[language];
  const logo = LOGO[language];

  const row = (html: string, padding: string) =>
    '<tr><td class="px" style="padding:' + padding + '">' + html + '</td></tr>';

  const eyebrowRow = eyebrow
    ? '<p style="margin:0 0 10px 0; font-family:' +
      display +
      '; font-size:11px; line-height:16px; font-weight:bold; letter-spacing:1.8px; text-transform:uppercase; color:' +
      CORAL +
      ';">' +
      escapeHtml(eyebrow) +
      '</p>'
    : '';

  const sectionRows = sections
    .filter((section) => section.html)
    .map((section) => row(section.html, (section.gap ?? 32) + 'px 40px 0 40px'))
    .join('');

  const discountRow = discountBlock ? row(discountBlock, '32px 40px 0 40px') : '';

  const actionRows = actions.length
    ? row(
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' +
          renderActions(language, actions) +
          '</table>',
        '30px 40px 0 40px'
      )
    : '';

  const footnoteRow = footnote
    ? row(
        '<p style="margin:0; font-family:' +
          bodyFont +
          '; font-size:12px; line-height:20px; color:' +
          FAINT +
          '; text-align:center;">' +
          escapeHtml(footnote) +
          '</p>',
        '16px 40px 0 40px'
      )
    : '';

  return [
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">',
    '<html xmlns="http://www.w3.org/1999/xhtml" lang="' + language + '">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta http-equiv="X-UA-Compatible" content="IE=edge" />',
    '<meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />',
    '<meta name="color-scheme" content="light" />',
    '<meta name="supported-color-schemes" content="light" />',
    '<meta name="x-apple-disable-message-reformatting" />',
    '<title>' + escapeHtml(headline) + '</title>',
    '<!--[if mso]>',
    '<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>',
    '<![endif]-->',
    '<style type="text/css">',
    // Progressive enhancement only. Every rule that matters is also inline,
    // because Gmail's clipped view and several Outlook builds drop this block.
    'body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }',
    'table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }',
    'img { -ms-interpolation-mode:bicubic; border:0; height:auto; line-height:100%; outline:none; text-decoration:none; }',
    'body { margin:0 !important; padding:0 !important; width:100% !important; }',
    'a { color:' + LINK + '; }',
    '@media screen and (max-width:620px) {',
    '  .wrapper { width:100% !important; }',
    '  .px { padding-left:22px !important; padding-right:22px !important; }',
    '  .stack { display:block !important; width:100% !important; max-width:100% !important; }',
    '  .h1 { font-size:24px !important; line-height:32px !important; }',
    '  .score-num { font-size:56px !important; line-height:60px !important; }',
    '  .btn a { display:block !important; }',
    '}',
    '</style>',
    '</head>',
    '<body style="margin:0; padding:0; width:100%; background-color:' + CANVAS + ';">',
    previewText ? previewBlock(previewText) : '',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:' +
      CANVAS +
      ';">',
    '<tr><td align="center" style="padding:24px 12px 40px 12px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="wrapper" style="width:600px; max-width:600px; background-color:' +
      CARD +
      ';">',

    // Masthead
    '<tr><td class="px" style="padding:28px 40px 22px 40px; border-bottom:2px solid ' + NAVY + ';">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>',
    '<td align="left">',
    '<a href="' + escapeHtml(siteUrl) + '" target="_blank" style="text-decoration:none;">',
    '<img src="' +
      logo.src +
      '" width="' +
      logo.width +
      '" height="' +
      logo.height +
      '" alt="' +
      escapeHtml(logo.alt) +
      '" style="display:block; border:0; outline:none; text-decoration:none; width:' +
      logo.width +
      'px; height:' +
      logo.height +
      'px;" />',
    '</a>',
    '</td>',
    '<td align="right" style="font-family:' +
      display +
      '; font-size:10px; line-height:16px; font-weight:bold; letter-spacing:1.6px; text-transform:uppercase; color:' +
      FAINT +
      ';">' +
      escapeHtml(mastheadTag ?? '') +
      '</td>',
    '</tr></table>',
    '</td></tr>',

    // Headline and lede
    row(
      eyebrowRow +
        '<h1 class="h1" style="margin:0 0 14px 0; font-family:' +
        display +
        '; font-size:28px; line-height:36px; font-weight:bold; letter-spacing:-0.6px; color:' +
        INK +
        ';">' +
        escapeHtml(headline) +
        '</h1>' +
        '<div style="font-family:' +
        bodyFont +
        ';">' +
        body +
        '</div>',
      '34px 40px 0 40px'
    ),

    sectionRows,
    discountRow,
    actionRows,
    footnoteRow,
    renderFooter(language, options),

    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>'
  ].join('\n');
}
