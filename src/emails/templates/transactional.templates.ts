import type { EmailTemplate, EmailLanguage, EmailTemplateContext } from '../email.types.js';
import type { EmailAction } from '../layout.js';
import { escapeHtml, interpolate, paragraph, renderLayout, scoreLine } from '../layout.js';

/**
 * The two messages a paying customer receives.
 *
 * Unlike the marketing ladder, these are not a sequence and not optional: each
 * one is the delivery of something the customer has paid for. They are
 * `category: 'transactional'`, which keeps them out of the marketing step picker
 * in the admin panel while still living in the same template master — one place
 * that lists every email the application can send.
 */

// ---------------------------------------------------------------------------
// Shared copy helpers
// ---------------------------------------------------------------------------

const INK = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';

function greeting(language: EmailLanguage, firstName: string | null): string {
  if (language === 'ja') {
    return firstName ? firstName + 'さん、こんにちは。' : 'こんにちは。';
  }
  return firstName ? 'Hi ' + firstName + ',' : 'Hi there,';
}

/**
 * The credentials panel.
 *
 * The password is set in a monospace face and spaced out, because the one thing
 * this block has to survive is being retyped by hand from a phone screen.
 */
function credentialsPanel(
  language: EmailLanguage,
  loginEmail: string,
  password: string | null
): string {
  const emailLabel = language === 'ja' ? 'ログインID（メールアドレス）' : 'Email';
  const passwordLabel = language === 'ja' ? 'パスワード' : 'Password';

  const existingNote =
    language === 'ja'
      ? 'パスワードは、以前に発行したものをそのままご利用ください。'
      : 'Your existing password still works — we have not changed it.';

  const row = (label: string, value: string, mono: boolean) =>
    [
      '<tr>',
      '<td style="padding:6px 0;font-size:12px;color:' + MUTED + ';width:38%;vertical-align:top;">' +
        escapeHtml(label) +
        '</td>',
      '<td style="padding:6px 0;font-size:' +
        (mono ? '18px' : '15px') +
        ';font-weight:700;color:' +
        INK +
        ';' +
        (mono ? "font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;letter-spacing:.06em;" : '') +
        'word-break:break-all;">' +
        escapeHtml(value) +
        '</td>',
      '</tr>'
    ].join('');

  const passwordRow = password
    ? row(passwordLabel, password, true)
    : '<tr><td colspan="2" style="padding:8px 0 0;font-size:13px;color:' +
      MUTED +
      ';">' +
      escapeHtml(existingNote) +
      '</td></tr>';

  return [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">',
    '<tr><td style="background:#f9fafb;border:1px solid ' + BORDER + ';border-radius:10px;padding:18px 22px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">',
    row(emailLabel, loginEmail, false),
    passwordRow,
    '</table>',
    '</td></tr>',
    '</table>'
  ].join('');
}

/** A short list of what is inside a report, as a bulleted block. */
function bullets(items: string[]): string {
  return (
    '<ul style="margin:0 0 16px;padding-left:20px;color:#374151;">' +
    items.map((item) => '<li style="margin:0 0 6px;">' + item + '</li>').join('') +
    '</ul>'
  );
}

// ---------------------------------------------------------------------------
// 1. Welcome — sent when the first sale settles
// ---------------------------------------------------------------------------

interface WelcomeCopy {
  subject: string;
  eyebrow: string;
  headline: string;
  intro: string[];
  credentialsLede: string;
  perks: string[];
  cta: string;
  footnote: string;
}

const WELCOME_COPY: Record<EmailLanguage, WelcomeCopy> = {
  ja: {
    subject: 'ようこそ — {{program_name}}のログイン情報のご案内',
    eyebrow: 'ご購入ありがとうございます',
    headline: '{{program_name}}へようこそ',
    intro: [
      'ご購入ありがとうございます。お手続きが完了し、{{program_name}}をご利用いただけるようになりました。',
      '下記のログイン情報でサインインしてください。'
    ],
    credentialsLede: 'ログイン情報',
    perks: [
      '認知トレーニングを毎日数分から',
      '記憶力・処理速度・論理的思考の各分野に対応',
      '進捗の記録と、IQスコアの推移の確認'
    ],
    cta: 'ログインしてはじめる',
    footnote: 'このメールは大切に保管してください。パスワードの再表示はできません。'
  },
  en: {
    subject: 'Welcome — your {{program_name}} login details',
    eyebrow: 'Thanks for your purchase',
    headline: 'Welcome to {{program_name}}',
    intro: [
      'Thank you for your purchase. Everything went through, and your access to {{program_name}} is now active.',
      'Sign in with the details below.'
    ],
    credentialsLede: 'Your login details',
    perks: [
      'Daily cognitive training in a few minutes a session',
      'Exercises across memory, processing speed and logical reasoning',
      'Progress tracking, so you can watch your score move'
    ],
    cta: 'Sign in and start',
    footnote: 'Keep this email — we cannot show you this password again.'
  }
};

const welcomeTemplate: EmailTemplate = {
  id: 'transactional_welcome',
  name: 'Welcome — brain training login details',
  description:
    'Sent once, when the first sale settles. Carries the customer\'s sign-in email and their one-time generated password for the brain training programme.',
  category: 'transactional',
  params: [
    'first_name',
    'honorific_name',
    'login_email',
    'login_password',
    'login_url',
    'program_name',
    'site_url'
  ],
  subject: { ja: WELCOME_COPY.ja.subject, en: WELCOME_COPY.en.subject },
  render(ctx: EmailTemplateContext): string {
    const copy = WELCOME_COPY[ctx.language] ?? WELCOME_COPY.ja;
    const fill = (text: string) => interpolate(text, { program_name: ctx.program_name });

    const body =
      paragraph(greeting(ctx.language, ctx.first_name)) +
      copy.intro.map((p) => paragraph(escapeHtml(fill(p)), { html: true })).join('') +
      '<p style="margin:0 0 10px;font-weight:700;color:' +
      INK +
      ';">' +
      escapeHtml(copy.credentialsLede) +
      '</p>' +
      credentialsPanel(ctx.language, ctx.login_email ?? ctx.email, ctx.login_password) +
      bullets(copy.perks.map((perk) => escapeHtml(perk)));

    const actions: EmailAction[] = [
      { label: fill(copy.cta), url: ctx.login_url ?? ctx.site_url, primary: true }
    ];

    return renderLayout({
      language: ctx.language,
      eyebrow: copy.eyebrow,
      headline: fill(copy.headline),
      body,
      actions,
      // Only warn about the password being unrepeatable when one was actually
      // issued. A returning customer keeping their old password does not need
      // to be told to save an email that contains no credential.
      footnote: ctx.login_password ? copy.footnote : undefined,
      siteUrl: ctx.site_url
    });
  }
};

// ---------------------------------------------------------------------------
// 2. Report ready — sent when the customer finishes the funnel
// ---------------------------------------------------------------------------

interface ReportCopy {
  subject: string;
  eyebrow: string;
  headline: string;
  intro: string[];
  firstSaleCta: string;
  crossSaleCta: string;
  /** Extra line, only when the cross-sale report is included. */
  crossSaleNote: string;
  footnote: string;
}

const REPORT_COPY: Record<EmailLanguage, ReportCopy> = {
  ja: {
    subject: '{{honorific_name}}のIQレポートの準備ができました',
    eyebrow: 'レポート完成',
    headline: 'IQレポートの準備ができました',
    intro: [
      'お待たせしました。詳細IQレポートと公式認定証の作成が完了しました。',
      '下のボタンから、いつでもご覧・ダウンロードいただけます。'
    ],
    firstSaleCta: '詳細レポートと認定証を見る',
    crossSaleCta: 'キャリア・適性レポートを見る',
    crossSaleNote:
      'あわせてご購入いただいたキャリア・適性レポートもご覧いただけます。',
    footnote: 'リンクはいつでもご利用いただけます。このメールを保存しておくと便利です。'
  },
  en: {
    subject: 'Your IQ report is ready',
    eyebrow: 'Report ready',
    headline: 'Your IQ report is ready',
    intro: [
      'Your detailed IQ report and official certificate have been prepared and are ready to open.',
      'Use the buttons below to view or download them whenever you like.'
    ],
    firstSaleCta: 'Open my report and certificate',
    crossSaleCta: 'Open my career and aptitude report',
    crossSaleNote:
      'Your career and aptitude report — bought alongside it — is ready too.',
    footnote: 'These links keep working, so it is worth keeping this email.'
  }
};

const reportReadyTemplate: EmailTemplate = {
  id: 'transactional_report_ready',
  name: 'Your report is ready',
  description:
    'Sent when the customer completes the funnel. Links to the first-sale report, and to the cross-sale report only when that upsell was actually purchased.',
  category: 'transactional',
  params: [
    'first_name',
    'honorific_name',
    'iq_score',
    'first_sale_report_url',
    'cross_sale_report_url',
    'site_url'
  ],
  subject: { ja: REPORT_COPY.ja.subject, en: REPORT_COPY.en.subject },
  render(ctx: EmailTemplateContext): string {
    const copy = REPORT_COPY[ctx.language] ?? REPORT_COPY.ja;

    // The cross-sale button exists only if that report does. This is the whole
    // conditional in the design: nothing else changes between a customer who
    // bought the upsell and one who did not, so there is no second variant to
    // keep in step.
    const hasCrossSale = Boolean(ctx.cross_sale_report_url);

    const body =
      paragraph(greeting(ctx.language, ctx.first_name)) +
      scoreLine(ctx.language, ctx.iq_score) +
      copy.intro.map((p) => paragraph(p)).join('') +
      (hasCrossSale ? paragraph(copy.crossSaleNote) : '');

    const actions: EmailAction[] = [
      {
        label: copy.firstSaleCta,
        url: ctx.first_sale_report_url ?? ctx.site_url,
        primary: true
      }
    ];

    if (hasCrossSale) {
      actions.push({
        label: copy.crossSaleCta,
        url: ctx.cross_sale_report_url as string,
        primary: false
      });
    }

    return renderLayout({
      language: ctx.language,
      eyebrow: copy.eyebrow,
      headline: copy.headline,
      body,
      actions,
      footnote: copy.footnote,
      siteUrl: ctx.site_url
    });
  }
};

export const transactionalTemplates: EmailTemplate[] = [welcomeTemplate, reportReadyTemplate];
