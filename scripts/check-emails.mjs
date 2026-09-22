/**
 * Email template checks.
 *
 *   npm run check:emails
 *
 * Renders every template in both languages and asserts the things that are
 * invisible until a customer complains:
 *
 *   - no `{{placeholder}}` survives into a sent message;
 *   - the reset email never carries a password;
 *   - the welcome email never announces a free trial unless there is one;
 *   - a report never offers a document that was not bought;
 *   - Japanese renders with a Japanese font stack and logo, not a Latin one;
 *   - the shell matches the reference design in docs/email-template-ref.
 *
 * Renders only. Nothing is sent, and no database is touched.
 */
const { listTemplates, renderTemplate } = await import('../src/emails/registry.ts');
const { createEmailContext, honorific } = await import('../src/emails/context.ts');

const problems = [];
const fail = (msg) => problems.push(msg);

const SITE = 'https://myiq-test.com';
const APP = 'https://boost.myiq-test.com';
const PASSWORD = 'K7MP-3QRT-9XYZ';

function contextFor(language, overrides = {}) {
  const firstName = language === 'ja' ? '太郎' : 'Yuki';
  return createEmailContext(
    { email: 'customer@example.com', language, site_url: SITE },
    {
      first_name: firstName,
      honorific_name: honorific(language, firstName),
      iq_score: 122,
      iq_band: language === 'ja' ? '高い' : 'Superior',
      cta_url: SITE + '/result',
      hours_since_quiz: 26,
      discount_code: 'BRAIN20',
      discount_percent: 20,
      login_email: 'customer@example.com',
      login_password: PASSWORD,
      login_url: APP + '/login',
      program_name: 'myIQ Cognitive Training Program',
      reset_url: APP + '/reset-password?token=t',
      reset_expires_hours: 1,
      new_email: 'new.address@example.com',
      old_email: 'customer@example.com',
      confirm_url: APP + '/confirm-email?token=preview',
      confirm_expires_hours: 1,
      first_sale_report_url: SITE + '/result',
      cross_sale_report_url: SITE + '/result/report',
      order_ref: 'myIQ_8421',
      order_date: '20 September 2026',
      quiz_id: '8421',
      first_sale_amount: '£2.99',
      cross_sale_amount: '£7.99',
      subscription_price: '£29.99',
      interval_days: 28,
      trial_end: null,
      contact_id: '42',
      contact_name: language === 'ja' ? '山田 太郎' : 'Yuki Tanaka',
      contact_email: 'writer@example.com',
      contact_topic: 'Billing or refunds',
      contact_message: 'I was charged twice for the same report. Could you check?',
      contact_language: language,
      contact_submitted_at: '2026-09-22T09:14:00.000Z',
      ...overrides
    }
  );
}

const LANGUAGES = ['en', 'ja'];
let rendered = 0;

/* ── every template, both languages ───────────────────────────────────────── */

/**
 * Designs whose reader is an operator, not a customer.
 *
 * They render in English whatever language produced them — the visitor’s
 * language travels as a field, because it is what the *reply* needs — so the
 * per-language assertions below do not apply, and would only assert that an
 * internal notice is not written in Japanese.
 */
const OPERATOR_ONLY = new Set(['contact_inquiry_admin']);

for (const template of listTemplates()) {
  for (const language of LANGUAGES) {
    if (language !== 'en' && OPERATOR_ONLY.has(template.id)) continue;

    const where = `${template.id} [${language}]`;
    const ctx = contextFor(language);

    let result;
    try {
      result = renderTemplate(template.id, ctx);
    } catch (error) {
      fail(`${where}: render threw — ${error.message}`);
      continue;
    }
    rendered += 1;

    const { subject, html } = result;

    // A placeholder that survives is the most visible possible defect: the
    // customer reads `{{first_name}}`.
    const leftInSubject = subject.match(/\{\{\s*\w+\s*\}\}/g);
    if (leftInSubject) fail(`${where}: subject still has ${leftInSubject.join(', ')}`);
    const leftInBody = html.match(/\{\{\s*\w+\s*\}\}/g);
    if (leftInBody) fail(`${where}: body still has ${leftInBody.join(', ')}`);

    if (!subject.trim()) fail(`${where}: empty subject`);

    // Every parameter the template declares must be one the context defines,
    // or a hosted ZeptoMail version of it silently merges an empty string.
    for (const param of template.params) {
      if (!(param in ctx)) fail(`${where}: declares "${param}", which the context does not define`);
    }

    // The shell, per the reference design.
    const shell = {
      'the pale canvas': 'background-color:#f2f5f9',
      'the navy masthead rule': 'border-bottom:2px solid #12294a',
      'a 600px card': 'width:600px; max-width:600px',
      'preview text': 'mso-hide:all',
      'the mobile gutter rule': '.px { padding-left:22px',
      'a footer support address': 'support@myiq-test.com',
      'footer legal links': '/legal/privacy'
    };
    for (const [what, needle] of Object.entries(shell)) {
      if (!html.includes(needle)) fail(`${where}: missing ${what}`);
    }

    // Language-specific rendering. A Latin-first stack falls back to a font
    // with no kana, and the whole message renders in the client's default serif.
    if (language === 'ja') {
      if (!html.includes('Hiragino Kaku Gothic')) fail(`${where}: no Japanese font stack`);
      if (html.includes("'Sora'")) fail(`${where}: Sora has no kana and must not be used for ja`);
      if (!html.includes('logo-jp-navy.png')) fail(`${where}: wrong masthead logo for ja`);
      if (!html.includes('lang="ja"')) fail(`${where}: html lang is not ja`);
    } else {
      if (!html.includes('logo-en-navy.png')) fail(`${where}: wrong masthead logo for en`);
      if (!html.includes('lang="en"')) fail(`${where}: html lang is not en`);
    }

    // Every link must be absolute: a relative href in an email resolves against
    // the webmail client's own domain.
    for (const href of html.match(/href="([^"]+)"/g) ?? []) {
      const url = href.slice(6, -1);
      if (!/^(https?:|mailto:)/.test(url)) fail(`${where}: relative link ${url}`);
    }
  }
}

/* ── the rules that protect the customer ──────────────────────────────────── */

for (const language of LANGUAGES) {
  const where = `[${language}]`;

  // 1. The reset email must never carry a credential. Mailing a new password
  //    would let anyone who can type an address change that account's password.
  const reset = renderTemplate('transactional_password_reset', contextFor(language)).html;
  if (reset.includes(PASSWORD)) fail(`reset ${where}: SHIPS A PASSWORD`);
  if (!reset.includes('reset-password?token=')) fail(`reset ${where}: no reset link`);

  // 2. The welcome email must not announce a trial that does not exist.
  const noTrial = renderTemplate('transactional_welcome', contextFor(language)).html;
  const trialWords = language === 'ja' ? ['無料トライアル'] : ['free trial', 'Free Trial'];
  for (const word of trialWords) {
    if (noTrial.includes(word)) fail(`welcome ${where}: claims a "${word}" with no trial_end set`);
  }

  const withTrial = renderTemplate(
    'transactional_welcome',
    contextFor(language, { trial_end: '25 September 2026' })
  ).html;
  if (language === 'en' && !withTrial.includes('free trial')) {
    fail(`welcome ${where}: trial block missing when trial_end IS set`);
  }
  if (!withTrial.includes('25 September 2026')) {
    fail(`welcome ${where}: trial end date not shown when set`);
  }

  // 3. A returning customer keeps their password, so none is shown.
  const returning = renderTemplate(
    'transactional_welcome',
    contextFor(language, { login_password: null })
  ).html;
  if (returning.includes(PASSWORD)) fail(`welcome ${where}: shows a password that was not issued`);

  // 4. The report must not offer a document the customer did not buy.
  const noUpsell = renderTemplate(
    'transactional_report_ready',
    contextFor(language, { cross_sale_report_url: null, cross_sale_amount: null })
  ).html;
  if (noUpsell.includes('/result/report')) fail(`report ${where}: links an unbought career report`);
  if (noUpsell.includes('£7.99')) fail(`report ${where}: bills for an unbought career report`);

  // 5. The email-change pair must not leak across addresses.
  const confirm = renderTemplate('transactional_email_change_confirm', contextFor(language)).html;
  if (!confirm.includes('confirm-email?token=')) fail(`email change ${where}: no confirmation link`);
  if (!confirm.includes('new.address@example.com')) fail(`email change ${where}: does not show the new address`);

  const notice = renderTemplate('transactional_email_change_notice', contextFor(language)).html;
  if (notice.includes('confirm-email?token=')) {
    fail(`email change notice ${where}: CARRIES THE CONFIRMATION LINK — the old address must not be able to approve its own replacement`);
  }
  // A security warning that asks the reader to click teaches the habit phishing
  // relies on. `class="btn"` is what a rendered button carries — the `.btn`
  // rule in the shell's style block is present on every message and is not one.
  if (notice.includes('class="btn"')) {
    fail(`email change notice ${where}: has a call-to-action button`);
  }
  // Only the footer's support and legal links should remain.
  const noticeLinks = (notice.match(/href="([^"]+)"/g) ?? []).filter(
    (h) => !h.includes('mailto:') && !h.includes('/legal/') && !h.includes('myiq-test.com"')
  );
  if (noticeLinks.length) fail(`email change notice ${where}: unexpected links ${noticeLinks.join(', ')}`);

  // 6. A customer with no name on file gets a clean sentence, not a gap.
  const anonymous = renderTemplate(
    'transactional_report_ready',
    contextFor(language, { first_name: null, honorific_name: honorific(language, null) })
  ).html;
  if (/,\s*<\/h1>/.test(anonymous)) fail(`report ${where}: dangling comma in the headline`);
  if (anonymous.includes('undefined') || anonymous.includes('null')) {
    fail(`report ${where}: leaked undefined/null into the copy`);
  }
}

/* ── report ───────────────────────────────────────────────────────────────── */

if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  process.exit(1);
}

console.log(`- rendered ${rendered} messages across ${listTemplates().length} templates x ${LANGUAGES.length} languages`);
console.log('- no placeholder survives into a sent message');
console.log('- the reset email carries no password');
console.log('- the welcome email claims a trial only when there is one');
console.log('- no email offers a document that was not bought');
console.log('- Japanese renders with a Japanese font stack and logo');
console.log('\n✓ email templates OK');
