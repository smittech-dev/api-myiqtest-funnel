import type { EmailTemplate, EmailLanguage, EmailTemplateContext } from '../email.types.js';
import type { EmailAction, NumberedItem, RecordField } from '../layout.js';
import {
  credentialsPanel,
  ctaCard,
  escapeHtml,
  interpolate,
  numberedList,
  panel,
  panelHeading,
  paragraph,
  receipt,
  recordRow,
  renderLayout,
  ruleNote,
  scoreCard,
  sectionHeading
} from '../layout.js';

/**
 * The three messages a paying customer receives.
 *
 * Unlike the marketing ladder, these are not a sequence and not optional: each
 * one delivers something the customer has paid for or asked for. They are
 * `category: 'transactional'`, which keeps them out of the marketing step
 * picker in the admin panel while still living in the same template master —
 * one place that lists every email the application can send.
 *
 * All three follow the reference designs in `docs/email-template-ref/`.
 */

const INK = '#101826';

function greeting(language: EmailLanguage, firstName: string | null): string {
  if (language === 'ja') {
    return firstName ? firstName + 'さん、こんにちは。' : 'こんにちは。';
  }
  return firstName ? 'Hi ' + firstName + ',' : 'Hi there,';
}

/** Appends the name to a headline in whichever way the language wants it. */
function withName(language: EmailLanguage, base: string, firstName: string | null): string {
  if (!firstName) return base;
  return language === 'ja' ? firstName + 'さん、' + base : base + ', ' + firstName;
}

// ---------------------------------------------------------------------------
// 1. Welcome — sent when the first sale settles
// ---------------------------------------------------------------------------

interface WelcomeCopy {
  subject: string;
  preview: string;
  mastheadTag: string;
  eyebrow: string;
  headline: string;
  lede: string;
  ctaTitle: string;
  ctaLabel: string;
  ctaNote: string;
  includedEyebrow: string;
  includedTitle: string;
  included: NumberedItem[];
  trialTitle: string;
  /** `{{trial_end}}` and `{{subscription_price}}` are filled at render time. */
  trialBody: string;
  renewTitle: string;
  renewBody: string;
  signInTitle: string;
  signInLede: string;
  emailLabel: string;
  passwordLabel: string;
  existingPassword: string;
  signInLabel: string;
  cancelLead: string;
  cancelBody: string;
  orderRefLabel: string;
  startedLabel: string;
  footnote: string;
}

const WELCOME_COPY: Record<EmailLanguage, WelcomeCopy> = {
  ja: {
    subject: '{{program_name}}へようこそ',
    preview: 'ログイン情報と、ご利用いただける内容のご案内です。',
    mastheadTag: 'トレーニング',
    eyebrow: 'ご利用開始',
    headline: '{{program_name}}へようこそ。',
    lede: 'IQテストは、いまの推論力がどこにあるかを示すものでした。トレーニングは、それを動かすための部分です。1日数分の短いセットを、レポートで弱点とされた領域に向けて行います。ご利用は今日から始められます。',
    ctaTitle: '最初のセッションをご用意しました',
    ctaLabel: 'トレーニングを始める',
    ctaNote: '1日10分ほどで十分です。',
    includedEyebrow: 'ご利用いただける内容',
    includedTitle: '初日からすべて',
    included: [
      {
        title: '毎日の脳トレクイズ',
        body: '記憶力・数的推論・言語・パターン認識・注意力・性格の6分野、各5レベル。1日1回、新しい20問が出題されます。'
      },
      {
        title: '25種類の脳トレゲーム',
        body: '5つのカテゴリーにわたるゲームを回数無制限で。スコアと自己ベストはすべて記録されます。'
      },
      {
        title: '分野別の進捗記録',
        body: '6分野が別々に動くため、どこが実際に伸びているかが分かります。'
      },
      {
        title: 'レポートと認定証',
        body: '発行済みです。サブスクリプションをどうされる場合でも、お客様のものです。'
      }
    ],
    trialTitle: '無料トライアル実施中',
    trialBody:
      '{{trial_end}}まで、すべての機能を無料でご利用いただけます。トライアル終了後は、解約されない限り{{interval_days}}日ごとに{{subscription_price}}が課金されます。継続に手続きは不要です。',
    renewTitle: 'ご請求について',
    renewBody:
      'サブスクリプションは{{subscription_price}}で{{interval_days}}日ごとに自動更新されます。解約はいつでも可能で、お支払い済みの期間は終了日までご利用いただけます。',
    signInTitle: 'ログイン情報',
    signInLede: 'こちらの情報でログインしてください。ログイン後にパスワードを変更されることをおすすめします。',
    emailLabel: 'メールアドレス',
    passwordLabel: 'パスワード',
    existingPassword: 'パスワードは、以前に発行したものをそのままご利用ください。',
    signInLabel: 'ログインする',
    cancelLead: '解約はワンクリックです。',
    cancelBody:
      'サブスクリプション画面からいつでも解約でき、電話も引き留めもありません。お支払い済みの期間は引き続きご利用いただけます。',
    orderRefLabel: '注文番号',
    startedLabel: '開始日',
    footnote: 'このパスワードを再度表示することはできません。このメールを保存しておいてください。'
  },
  en: {
    subject: 'Welcome - {{program_name}}',
    preview: 'Your sign-in details, what is included, and when it renews.',
    mastheadTag: 'Training program',
    eyebrow: 'Access is open',
    headline: 'Welcome to the {{program_name}}.',
    lede: 'Your assessment told you where your reasoning stands today. The training program is the part that moves it — short daily sets, aimed at the domains your own report marked as weakest. Full access starts now.',
    ctaTitle: 'Your first session is waiting',
    ctaLabel: 'Boost My IQ',
    ctaNote: 'Around ten minutes a day is enough.',
    includedEyebrow: 'What you have access to',
    includedTitle: 'Everything, from day one',
    included: [
      {
        title: 'A daily quiz across six domains',
        body: 'Memory, numerical, verbal, pattern recognition, attention and personality — five levels each, twenty fresh questions a day.'
      },
      {
        title: 'Twenty-five brain games',
        body: 'Five categories, unlimited plays, with every score and personal best kept.'
      },
      {
        title: 'Progress tracked per domain',
        body: 'The six domains move separately, so you can see which one is actually shifting.'
      },
      {
        title: 'Your report and certificate',
        body: 'Already issued, and yours to keep whatever you decide about the subscription.'
      }
    ],
    trialTitle: 'Your free trial is active',
    trialBody:
      'Enjoy full access at no cost until {{trial_end}}. After that, your subscription renews at {{subscription_price}} every {{interval_days}} days unless you cancel before then. No action is required to continue.',
    renewTitle: 'About your billing',
    renewBody:
      'Your subscription renews automatically at {{subscription_price}} every {{interval_days}} days. You can cancel at any time and keep access for the period you have already paid for.',
    signInTitle: 'Your sign-in details',
    signInLede: 'Use these to sign in. We recommend changing the password once you are in.',
    emailLabel: 'Email',
    passwordLabel: 'Password',
    existingPassword: 'Your existing password still works — we have not changed it.',
    signInLabel: 'Sign in',
    cancelLead: 'Cancelling takes one click.',
    cancelBody:
      'No phone call and no retention maze — cancel from your subscription page and the renewal simply does not happen. You keep access for the period you have already paid for.',
    orderRefLabel: 'Order reference',
    startedLabel: 'Started',
    footnote: 'Keep this email — we cannot show you this password again.'
  }
};

const welcomeTemplate: EmailTemplate = {
  id: 'transactional_welcome',
  name: 'Welcome — myIQ Cognitive Training Program login details',
  description:
    "Sent once, when the first sale settles. Carries the customer's sign-in email and their one-time generated password for the myIQ Cognitive Training Program.",
  category: 'transactional',
  params: [
    'first_name',
    'honorific_name',
    'login_email',
    'login_password',
    'login_url',
    'program_name',
    'site_url',
    'subscription_price',
    'trial_end',
    'interval_days',
    'order_ref',
    'order_date'
  ],
  subject: { ja: WELCOME_COPY.ja.subject, en: WELCOME_COPY.en.subject },
  render(ctx: EmailTemplateContext): string {
    const language = ctx.language;
    const copy = WELCOME_COPY[language] ?? WELCOME_COPY.ja;
    const fill = (text: string) =>
      interpolate(text, {
        program_name: ctx.program_name,
        trial_end: ctx.trial_end,
        subscription_price: ctx.subscription_price,
        interval_days: ctx.interval_days
      } as Partial<EmailTemplateContext>);

    const signInUrl = ctx.login_url ?? ctx.site_url;

    /**
     * The trial paragraph only exists when there genuinely is a trial.
     *
     * Announcing a free trial that the subscription does not carry is not a
     * copy slip — it is telling a customer they will not be charged when they
     * will be. Without `trial_end` the block is replaced by the plain billing
     * note, which says the same thing truthfully.
     */
    const billing = ctx.trial_end
      ? panel(
          panelHeading(language, copy.trialTitle) +
            '<p style="margin:0; font-family:inherit; font-size:13px; line-height:22px; color:#5a6779;">' +
            escapeHtml(fill(copy.trialBody)) +
            '</p>'
        )
      : ctx.subscription_price
        ? panel(
            panelHeading(language, copy.renewTitle) +
              '<p style="margin:0; font-size:13px; line-height:22px; color:#5a6779;">' +
              escapeHtml(fill(copy.renewBody)) +
              '</p>'
          )
        : '';

    const credentials = panel(
      panelHeading(language, copy.signInTitle, ctx.login_password ? copy.signInLede : undefined) +
        credentialsPanel(language, {
          emailLabel: copy.emailLabel,
          email: ctx.login_email ?? ctx.email,
          passwordLabel: copy.passwordLabel,
          password: ctx.login_password,
          note: copy.existingPassword
        }) +
        '<div style="margin-top:18px;">' +
        // Navy here, because the coral button above is the one action this
        // email is really asking for.
        renderSignIn(language, copy.signInLabel, signInUrl) +
        '</div>',
      'blue'
    );

    const record: RecordField[] = [];
    if (ctx.order_ref) record.push({ label: copy.orderRefLabel, value: ctx.order_ref });
    if (ctx.order_date) record.push({ label: copy.startedLabel, value: ctx.order_date });

    return renderLayout({
      language,
      mastheadTag: copy.mastheadTag,
      previewText: copy.preview,
      eyebrow: copy.eyebrow,
      headline: fill(copy.headline),
      body: paragraph(greeting(language, ctx.first_name)) + paragraph(fill(copy.lede)),
      sections: [
        {
          html: ctaCard(language, {
            title: copy.ctaTitle,
            label: copy.ctaLabel,
            url: signInUrl,
            note: copy.ctaNote
          }),
          gap: 26
        },
        {
          html:
            sectionHeading(language, copy.includedEyebrow, copy.includedTitle) +
            numberedList(language, copy.included)
        },
        { html: billing },
        { html: credentials },
        {
          html: ruleNote(
            language,
            '<strong class="e-ink" style="color:' +
              INK +
              ';">' +
              escapeHtml(copy.cancelLead) +
              '</strong> ' +
              escapeHtml(copy.cancelBody)
          ),
          gap: 22
        },
        { html: record.length ? recordRow(language, record) : '', gap: 26 }
      ],
      // Only warn about the password being unrepeatable when one was actually
      // issued. A returning customer keeping their old password does not need
      // to be told to save an email that contains no credential.
      footnote: ctx.login_password ? copy.footnote : undefined,
      recipientEmail: ctx.login_email ?? ctx.email,
      siteUrl: ctx.site_url
    });
  }
};

/** The secondary sign-in button inside the credentials panel. */
function renderSignIn(language: EmailLanguage, label: string, url: string): string {
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn">' +
    '<tr><td align="center" bgcolor="#12294a" style="border-radius:999px;">' +
    '<a href="' +
    escapeHtml(url) +
    '" target="_blank" style="display:inline-block; padding:13px 28px; font-family:' +
    (language === 'ja'
      ? "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',Meiryo,sans-serif"
      : "'Sora','Helvetica Neue',Helvetica,Arial,sans-serif") +
    '; font-size:14px; line-height:18px; font-weight:bold; color:#ffffff; text-decoration:none; border-radius:999px;">' +
    escapeHtml(label) +
    '</a>' +
    '</td></tr></table>'
  );
}

// ---------------------------------------------------------------------------
// 2. Report ready — the customer finished the funnel
// ---------------------------------------------------------------------------

interface ReportCopy {
  subject: string;
  preview: string;
  mastheadTag: string;
  eyebrow: string;
  headline: string;
  lede: string;
  scoreLabel: string;
  documentsTitle: string;
  firstSaleCta: string;
  crossSaleTitle: string;
  crossSaleCta: string;
  receiptEyebrow: string;
  invoiceLabel: string;
  certificateLabel: string;
  reportLabel: string;
  orderRefLabel: string;
  completedLabel: string;
  footnote: string;
}

const REPORT_COPY: Record<EmailLanguage, ReportCopy> = {
  ja: {
    subject: 'IQレポートの準備ができました',
    preview: '標準化されたIQスコアと、分野別スコア、認定証をご確認いただけます。',
    mastheadTag: 'レポート完成',
    eyebrow: '採点完了',
    headline: 'レポートの準備ができました',
    lede: 'myIQテストの受験、お疲れさまでした。難易度の高い問題も含まれていますので、最後まで解き切られたことは立派です。',
    scoreLabel: 'あなたのIQスコア',
    documentsTitle: '認定証の準備ができました',
    firstSaleCta: '結果を見る',
    crossSaleTitle: 'キャリア・適性レポート',
    crossSaleCta: 'キャリアレポートを見る',
    receiptEyebrow: 'ご購入明細',
    invoiceLabel: '請求番号',
    certificateLabel: '認定証と詳細レポート',
    reportLabel: 'キャリア・適性レポート',
    orderRefLabel: '注文番号',
    completedLabel: '受験日',
    footnote: 'リンクはいつでもご利用いただけます。このメールを保存しておくと便利です。'
  },
  en: {
    subject: 'Your IQ report is ready',
    preview: 'Your standardised IQ score, your domain scores, and your certificate.',
    mastheadTag: 'Report ready',
    eyebrow: 'Scoring complete',
    headline: 'Your report is ready',
    lede: 'You have finished the myIQ Test, and you did well. Some of those items are genuinely hard, so getting to the end of them is worth a congratulations.',
    scoreLabel: 'Your IQ score',
    documentsTitle: 'Your certificate is ready',
    firstSaleCta: 'Open my result',
    crossSaleTitle: 'Career and aptitude report',
    crossSaleCta: 'Open my career report',
    receiptEyebrow: 'Your receipt',
    invoiceLabel: 'Invoice',
    certificateLabel: 'Certificate and detailed report',
    reportLabel: 'Career and aptitude report',
    orderRefLabel: 'Order reference',
    completedLabel: 'Completed',
    footnote: 'These links keep working, so it is worth keeping this email.'
  }
};

const reportReadyTemplate: EmailTemplate = {
  id: 'transactional_report_ready',
  name: 'Report ready — certificate and detailed report',
  description:
    'Sent when the funnel completes. Carries the IQ score, a link per report the customer actually bought, and the receipt.',
  category: 'transactional',
  params: [
    'first_name',
    'honorific_name',
    'iq_score',
    'iq_band',
    'first_sale_report_url',
    'cross_sale_report_url',
    'site_url',
    'quiz_id',
    'order_ref',
    'order_date',
    'first_sale_amount',
    'cross_sale_amount'
  ],
  subject: { ja: REPORT_COPY.ja.subject, en: REPORT_COPY.en.subject },
  render(ctx: EmailTemplateContext): string {
    const language = ctx.language;
    const copy = REPORT_COPY[language] ?? REPORT_COPY.ja;

    const score =
      ctx.iq_score !== null && ctx.iq_score !== undefined
        ? scoreCard(language, { label: copy.scoreLabel, score: ctx.iq_score, band: ctx.iq_band })
        : '';

    const documents = ctx.first_sale_report_url
      ? panel(
          '<h3 style="margin:0 0 18px 0; text-align:center; font-size:16px; line-height:24px; font-weight:bold; color:' +
            INK +
            ';">' +
            escapeHtml(copy.documentsTitle) +
            '</h3>' +
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center">' +
            renderPill(language, copy.firstSaleCta, ctx.first_sale_report_url) +
            '</td></tr></table>'
        )
      : '';

    // Only offered when that upsell was actually paid for — the send path
    // resolves it from succeeded transactions, so this cannot advertise a
    // document the customer does not own.
    const crossSale = ctx.cross_sale_report_url
      ? panel(
          '<h3 style="margin:0 0 18px 0; text-align:center; font-size:16px; line-height:24px; font-weight:bold; color:' +
            INK +
            ';">' +
            escapeHtml(copy.crossSaleTitle) +
            '</h3>' +
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center">' +
            renderPill(language, copy.crossSaleCta, ctx.cross_sale_report_url, '#12294a') +
            '</td></tr></table>',
          'blue'
        )
      : '';

    const receiptRows: RecordField[] = [];
    if (ctx.quiz_id) receiptRows.push({ label: copy.invoiceLabel, value: 'myIQ_' + ctx.quiz_id });
    if (ctx.first_sale_amount) {
      receiptRows.push({ label: copy.certificateLabel, value: ctx.first_sale_amount });
    }
    if (ctx.cross_sale_amount) {
      receiptRows.push({ label: copy.reportLabel, value: ctx.cross_sale_amount });
    }

    const record: RecordField[] = [];
    if (ctx.order_ref) record.push({ label: copy.orderRefLabel, value: ctx.order_ref });
    if (ctx.order_date) record.push({ label: copy.completedLabel, value: ctx.order_date });

    return renderLayout({
      language,
      mastheadTag: copy.mastheadTag,
      previewText: interpolate(copy.preview, ctx),
      eyebrow: copy.eyebrow,
      headline: withName(language, copy.headline, ctx.first_name),
      body: paragraph(greeting(language, ctx.first_name)) + paragraph(copy.lede),
      sections: [
        { html: score, gap: 26 },
        { html: documents },
        { html: crossSale },
        { html: receiptRows.length ? panel(receipt(language, { eyebrow: copy.receiptEyebrow, rows: receiptRows })) : '' },
        { html: record.length ? recordRow(language, record) : '', gap: 26 }
      ],
      footnote: copy.footnote,
      recipientEmail: ctx.email,
      siteUrl: ctx.site_url
    });
  }
};

/** A centred pill button, used inside the document panels. */
function renderPill(language: EmailLanguage, label: string, url: string, bg = '#d94f3d'): string {
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="btn" align="center" style="margin:0 auto;">' +
    '<tr><td align="center" bgcolor="' +
    bg +
    '" style="border-radius:999px;">' +
    '<a href="' +
    escapeHtml(url) +
    '" target="_blank" style="display:inline-block; padding:14px 30px; font-family:' +
    (language === 'ja'
      ? "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',Meiryo,sans-serif"
      : "'Sora','Helvetica Neue',Helvetica,Arial,sans-serif") +
    '; font-size:15px; line-height:18px; font-weight:bold; color:#ffffff; text-decoration:none; border-radius:999px;">' +
    escapeHtml(label) +
    '</a>' +
    '</td></tr></table>'
  );
}

// ---------------------------------------------------------------------------
// 3. Password reset — the member asked for a new password
// ---------------------------------------------------------------------------

interface ResetCopy {
  subject: string;
  preview: string;
  mastheadTag: string;
  eyebrow: string;
  headline: string;
  lede: string;
  ctaTitle: string;
  ctaLabel: string;
  ctaNote: string;
  ignoreLead: string;
  ignoreBody: string;
  footnote: string;
}

const RESET_COPY: Record<EmailLanguage, ResetCopy> = {
  ja: {
    subject: 'パスワード再設定のご案内',
    preview: 'パスワード再設定用のリンクをお送りしています。有効期限にご注意ください。',
    mastheadTag: 'アカウント',
    eyebrow: 'パスワード再設定',
    headline: 'パスワードを再設定してください',
    lede: '{{program_name}}のパスワード再設定のリクエストを受け付けました。下のボタンから新しいパスワードを設定してください。',
    ctaTitle: '新しいパスワードを設定',
    ctaLabel: 'パスワードを再設定する',
    ctaNote: 'このリンクの有効期限は{{reset_expires_hours}}時間です。',
    ignoreLead: '心当たりがない場合は、このメールを破棄してください。',
    ignoreBody: 'パスワードは変更されず、アカウントは安全なままです。',
    footnote: '新しいパスワードを設定すると、すべての端末からログアウトされます。'
  },
  en: {
    subject: 'Reset your {{program_name}} password',
    preview: 'A single-use link to set a new password. It expires shortly.',
    mastheadTag: 'Account',
    eyebrow: 'Password reset',
    headline: 'Set a new password',
    lede: 'We received a request to reset the password for your {{program_name}} account. Use the button below to choose a new one.',
    ctaTitle: 'Choose a new password',
    ctaLabel: 'Reset my password',
    ctaNote: 'This link is valid for {{reset_expires_hours}} hour(s).',
    ignoreLead: 'If you did not ask for this, you can ignore this email.',
    ignoreBody: 'Your password has not changed and your account is safe.',
    footnote: 'Setting a new password signs you out on every device.'
  }
};

/**
 * Note what this email does *not* contain: a password.
 *
 * The welcome message delivers a credential because the funnel never asks the
 * customer to choose one. A reset cannot work that way — mailing a new password
 * would change the account's password for anyone who can type an address into
 * the forgot-password form. So this carries a single-use link instead, and the
 * account is untouched until the member actually sets something.
 */
const passwordResetTemplate: EmailTemplate = {
  id: 'transactional_password_reset',
  name: 'Password reset — myIQ Cognitive Training Program',
  description:
    'Sent when a member asks to reset their myIQ Cognitive Training Program password. Carries a single-use, expiring link — never a password.',
  category: 'transactional',
  params: [
    'first_name',
    'honorific_name',
    'reset_url',
    'reset_expires_hours',
    'program_name',
    'site_url'
  ],
  subject: { ja: RESET_COPY.ja.subject, en: RESET_COPY.en.subject },
  render(ctx: EmailTemplateContext): string {
    const language = ctx.language;
    const copy = RESET_COPY[language] ?? RESET_COPY.ja;
    const fill = (text: string) =>
      interpolate(text, {
        program_name: ctx.program_name,
        reset_expires_hours: ctx.reset_expires_hours
      } as Partial<EmailTemplateContext>);

    return renderLayout({
      language,
      mastheadTag: copy.mastheadTag,
      previewText: copy.preview,
      eyebrow: copy.eyebrow,
      headline: copy.headline,
      body: paragraph(greeting(language, ctx.first_name)) + paragraph(fill(copy.lede)),
      sections: [
        {
          html: ctaCard(language, {
            title: copy.ctaTitle,
            label: copy.ctaLabel,
            url: ctx.reset_url ?? ctx.site_url,
            note: fill(copy.ctaNote)
          }),
          gap: 26
        },
        {
          html: ruleNote(
            language,
            '<strong class="e-ink" style="color:' +
              INK +
              ';">' +
              escapeHtml(copy.ignoreLead) +
              '</strong> ' +
              escapeHtml(copy.ignoreBody)
          ),
          gap: 26
        }
      ],
      footnote: copy.footnote,
      recipientEmail: ctx.email,
      siteUrl: ctx.site_url
    });
  }
};

// ---------------------------------------------------------------------------
// 4 & 5. Changing the email address
//
// Two messages, deliberately. The new address gets a link because it has to
// prove it is reachable before the account moves to it; the old address gets a
// warning because it is the only party who can tell us the change was not
// theirs. Sending only the first would make an account takeover silent.
// ---------------------------------------------------------------------------

interface EmailChangeCopy {
  subject: string;
  preview: string;
  mastheadTag: string;
  eyebrow: string;
  headline: string;
  lede: string;
  fromLabel: string;
  toLabel: string;
  ctaTitle: string;
  ctaLabel: string;
  ctaNote: string;
  ignoreLead: string;
  ignoreBody: string;
  footnote: string;
}

const EMAIL_CONFIRM_COPY: Record<EmailLanguage, EmailChangeCopy> = {
  ja: {
    subject: 'メールアドレス変更の確認',
    preview: 'このアドレスで受信できることをご確認ください。確認するまで変更は反映されません。',
    mastheadTag: 'アカウント',
    eyebrow: 'メールアドレスの変更',
    headline: '新しいメールアドレスの確認',
    lede: '{{program_name}}のログイン用メールアドレスを、このアドレスへ変更するリクエストを受け付けました。下のボタンからご確認ください。',
    fromLabel: '現在のアドレス',
    toLabel: '新しいアドレス',
    ctaTitle: 'このアドレスを確認する',
    ctaLabel: 'メールアドレスを確認',
    ctaNote: 'このリンクの有効期限は{{confirm_expires_hours}}時間です。',
    ignoreLead: '心当たりがない場合は、このメールを破棄してください。',
    ignoreBody: '確認されるまで、アカウントのメールアドレスは変更されません。',
    footnote: '確認後は、新しいアドレスでログインしてください。'
  },
  en: {
    subject: 'Confirm your new email address',
    preview: 'Confirm you can receive mail here. Nothing changes until you do.',
    mastheadTag: 'Account',
    eyebrow: 'Email change',
    headline: 'Confirm your new address',
    lede: 'We received a request to move your {{program_name}} sign-in to this address. Confirm it with the button below.',
    fromLabel: 'Current address',
    toLabel: 'New address',
    ctaTitle: 'Confirm this address',
    ctaLabel: 'Confirm email address',
    ctaNote: 'This link is valid for {{confirm_expires_hours}} hour(s).',
    ignoreLead: 'If you did not ask for this, you can ignore this email.',
    ignoreBody: 'Your account address will not change unless this link is followed.',
    footnote: 'After confirming, sign in with the new address.'
  }
};

/** The two addresses side by side, so the reader can check the new one for typos. */
function addressPanel(
  copy: { fromLabel: string; toLabel: string },
  ctx: EmailTemplateContext
): string {
  const row = (label: string, value: string, strong: boolean) =>
    '<tr><td style="padding:12px 16px;">' +
    '<p style="margin:0 0 2px 0; font-size:10px; line-height:16px; letter-spacing:1.2px; text-transform:uppercase; color:#7d8797;">' +
    escapeHtml(label) +
    '</p>' +
    '<p style="margin:0; font-size:14px; line-height:22px; font-weight:' +
    (strong ? '700' : '400') +
    '; color:' +
    (strong ? '#12294a' : '#5a6779') +
    '; word-break:break-all;">' +
    escapeHtml(value) +
    '</p></td></tr>';

  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff; border:1px solid rgba(18,41,74,0.12); border-radius:10px;">' +
    row(copy.fromLabel, ctx.old_email ?? '', false) +
    row(copy.toLabel, ctx.new_email ?? '', true) +
    '</table>'
  );
}

/**
 * Sent to the **new** address only.
 *
 * Carries the single-use link that completes the change. Nothing on the account
 * moves until it is followed, which is what stops a mistyped address from
 * locking a paying member out of what they bought.
 */
const emailChangeConfirmTemplate: EmailTemplate = {
  id: 'transactional_email_change_confirm',
  name: 'Email change — confirm the new address',
  description:
    'Sent to the new address when a member asks to change their sign-in email. Carries a single-use, expiring confirmation link.',
  category: 'transactional',
  params: [
    'first_name',
    'honorific_name',
    'new_email',
    'old_email',
    'confirm_url',
    'confirm_expires_hours',
    'program_name',
    'site_url'
  ],
  subject: { ja: EMAIL_CONFIRM_COPY.ja.subject, en: EMAIL_CONFIRM_COPY.en.subject },
  render(ctx: EmailTemplateContext): string {
    const language = ctx.language;
    const copy = EMAIL_CONFIRM_COPY[language] ?? EMAIL_CONFIRM_COPY.ja;
    const fill = (text: string) =>
      interpolate(text, {
        program_name: ctx.program_name,
        confirm_expires_hours: ctx.confirm_expires_hours
      } as Partial<EmailTemplateContext>);

    return renderLayout({
      language,
      mastheadTag: copy.mastheadTag,
      previewText: copy.preview,
      eyebrow: copy.eyebrow,
      headline: copy.headline,
      body: paragraph(greeting(language, ctx.first_name)) + paragraph(fill(copy.lede)),
      sections: [
        { html: panel(addressPanel(copy, ctx), 'blue'), gap: 26 },
        {
          html: ctaCard(language, {
            title: copy.ctaTitle,
            label: copy.ctaLabel,
            url: ctx.confirm_url ?? ctx.site_url,
            note: fill(copy.ctaNote)
          }),
          gap: 26
        },
        {
          html: ruleNote(
            language,
            '<strong class="e-ink" style="color:' +
              INK +
              ';">' +
              escapeHtml(copy.ignoreLead) +
              '</strong> ' +
              escapeHtml(copy.ignoreBody)
          ),
          gap: 26
        }
      ],
      footnote: copy.footnote,
      recipientEmail: ctx.new_email ?? ctx.email,
      siteUrl: ctx.site_url
    });
  }
};

interface EmailNoticeCopy {
  subject: string;
  preview: string;
  mastheadTag: string;
  eyebrow: string;
  headline: string;
  lede: string;
  fromLabel: string;
  toLabel: string;
  alertLead: string;
  alertBody: string;
  footnote: string;
}

const EMAIL_NOTICE_COPY: Record<EmailLanguage, EmailNoticeCopy> = {
  ja: {
    subject: '【重要】メールアドレス変更のリクエストを受け付けました',
    preview: 'アカウントのメールアドレス変更がリクエストされました。心当たりがない場合はご連絡ください。',
    mastheadTag: 'セキュリティ',
    eyebrow: 'セキュリティのお知らせ',
    headline: 'メールアドレスの変更がリクエストされました',
    lede: '{{program_name}}のアカウントについて、ログイン用メールアドレスの変更リクエストを受け付けました。新しいアドレスで確認が完了するまで、変更は反映されません。',
    fromLabel: '現在のアドレス',
    toLabel: 'リクエストされたアドレス',
    alertLead: '心当たりがない場合は、すぐにご連絡ください。',
    alertBody:
      'パスワードの変更と、アカウント保護のご案内をいたします。確認が完了するまで変更は反映されません。',
    footnote: 'このお知らせは、変更前のアドレスにお送りしています。'
  },
  en: {
    subject: 'Security notice: a change to your email address was requested',
    preview: 'Someone asked to move your account to a different address. If that was not you, tell us.',
    mastheadTag: 'Security',
    eyebrow: 'Security notice',
    headline: 'A change to your email address was requested',
    lede: 'We received a request to move your {{program_name}} sign-in to a different address. It will only take effect once that address is confirmed.',
    fromLabel: 'Current address',
    toLabel: 'Requested address',
    alertLead: 'If this was not you, contact us immediately.',
    alertBody:
      'Change your password and we will help secure the account. Nothing moves until the new address is confirmed.',
    footnote: 'This notice was sent to the address currently on the account.'
  }
};

/**
 * Sent to the **old** address only.
 *
 * The old address is the only party who can tell us the change was not theirs,
 * so it is told regardless — without this, someone with a live session could
 * move the account quietly and the owner would find out when they could no
 * longer sign in.
 */
const emailChangeNoticeTemplate: EmailTemplate = {
  id: 'transactional_email_change_notice',
  name: 'Email change — notice to the old address',
  description:
    'Sent to the current address whenever an email change is requested, so a takeover attempt is visible to the real owner. Carries no link.',
  category: 'transactional',
  params: ['first_name', 'honorific_name', 'new_email', 'old_email', 'program_name', 'site_url'],
  subject: { ja: EMAIL_NOTICE_COPY.ja.subject, en: EMAIL_NOTICE_COPY.en.subject },
  render(ctx: EmailTemplateContext): string {
    const language = ctx.language;
    const copy = EMAIL_NOTICE_COPY[language] ?? EMAIL_NOTICE_COPY.ja;
    const fill = (text: string) =>
      interpolate(text, { program_name: ctx.program_name } as Partial<EmailTemplateContext>);

    return renderLayout({
      language,
      mastheadTag: copy.mastheadTag,
      previewText: copy.preview,
      eyebrow: copy.eyebrow,
      headline: copy.headline,
      body: paragraph(greeting(language, ctx.first_name)) + paragraph(fill(copy.lede)),
      sections: [
        { html: panel(addressPanel(copy, ctx)), gap: 26 },
        {
          // No button anywhere in this message. A security notice that asks the
          // reader to click something teaches exactly the habit phishing relies
          // on — if they need to act, they come to the site themselves.
          html: ruleNote(
            language,
            '<strong class="e-ink" style="color:' +
              INK +
              ';">' +
              escapeHtml(copy.alertLead) +
              '</strong> ' +
              escapeHtml(copy.alertBody)
          ),
          gap: 26
        }
      ],
      footnote: copy.footnote,
      recipientEmail: ctx.old_email ?? ctx.email,
      siteUrl: ctx.site_url
    });
  }
};

export const transactionalTemplates: EmailTemplate[] = [
  welcomeTemplate,
  reportReadyTemplate,
  passwordResetTemplate,
  emailChangeConfirmTemplate,
  emailChangeNoticeTemplate
];

/** Unused by the designs above, but kept for `EmailAction`-based callers. */
export type { EmailAction };
