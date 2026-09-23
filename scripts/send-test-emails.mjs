/**
 * Sends every email in the registry to one address, for review.
 *
 *   npm run send:test-emails -- you@example.com
 *   npm run send:test-emails -- you@example.com --lang=en --variants
 *   npm run send:test-emails -- you@example.com --dry-run
 *
 * Temporary review tool. It exists so the whole set of designs can be read in a
 * real mail client — where the width, the dark-mode inversion, the clipped
 * Gmail footer and the rendered Japanese are things you can only see by looking
 * — rather than in a browser tab, which is what `npm run preview:emails` is for.
 *
 * Every send goes through `emailService`, not a hand-rolled request, so what
 * lands in the inbox is what production would send: the same ZeptoMail payload,
 * the same tracking flags, and the hosted-template path taken for any id that
 * has a ZEPTOMAIL_TEMPLATE_<ID> set. A design that renders here but breaks in
 * production is exactly the thing this is meant to catch, so there is no second
 * code path for it to hide in.
 *
 * The dynamic values are fixtures, defined per template from what each one
 * declares in `params`. They are deliberately realistic — prices in the
 * currency of each funnel, a Japanese name in the Japanese sends — because a
 * review is only worth as much as the data it is done against.
 *
 * The reminder ladder is not guessed at: which template goes out at 24 hours,
 * which discount rides with it and how many rungs there even are all live in
 * `email_marketing_steps`, editable from the admin panel, and are read from
 * there. Hardcoding the sequence from the brief would review a ladder nobody is
 * running the moment an operator reorders a step. One email is sent per
 * configured step, so two steps pointing at the same design are both reviewed,
 * against their own discount.
 *
 * The only database access is that one read. Nothing is written, and `--no-db`
 * falls back to the seeded defaults for a machine with no database to hand.
 */
import { setTimeout as sleep } from 'node:timers/promises';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--') && !a.includes('=')));
const valued = new Map(
  args
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => {
      const i = a.indexOf('=');
      return [a.slice(2, i), a.slice(i + 1)];
    })
);

const target = args.find((a) => !a.startsWith('--')) || process.env.TEST_EMAIL || '';

if (!target || !target.includes('@')) {
  console.error(`
Usage: npm run send:test-emails -- <target-email> [options]

  --lang=en|ja|both   Which funnel's copy to send. Default: both.
  --only=id,id        Only these template ids. Default: all of them.
  --variants          Also send the edge cases (no upsell, returning customer,
                      trial, anonymous) that are easy to forget to check.
  --dry-run           Render and report, hand nothing to ZeptoMail.
  --no-plus           Do not tag the recipient with +template_lang. Use this if
                      the target mailbox rejects plus-addressing.
  --no-db             Do not read the reminder ladder from the database; use
                      the seeded defaults instead.
  --delay=400         Milliseconds between sends. Default: 400.

Or set TEST_EMAIL in the environment instead of passing the address.
`);
  process.exit(1);
}

const dryRun = flags.has('--dry-run');

// Everything here has to be set before the first import below, because the
// config module reads process.env once, at import time, and every later import
// gets that same cached object. dotenv does not overwrite what is already set,
// so these win over .env.

// Read-only means read-only. `DB_SYNCHRONIZE=true` is set in development, and
// initialising the data source under it makes TypeORM diff every entity against
// the live schema and start issuing ALTER TABLEs — which a script for reviewing
// email copy has no business doing to anyone's database. The query log goes too:
// it is thousands of lines of schema introspection around the two SELECTs that
// are actually wanted, and it buries the thing being reviewed.
process.env.DB_SYNCHRONIZE = 'false';
process.env.DB_LOGGING = 'false';

if (dryRun) {
  process.env.EMAIL_DRY_RUN = 'true';
  // Otherwise a .env with sending switched off would report every message as
  // "skipped" and tell us nothing about the templates, which is the opposite of
  // what a dry run is for.
  process.env.ZEPTOMAIL_ENABLED = 'true';
}

// Run through tsx (see the npm script), which compiles the TypeScript imports
// below on the fly.
const { listTemplates, providerTemplateKey, getTemplate } = await import(
  '../src/emails/registry.ts'
);
const { createEmailContext, honorific } = await import('../src/emails/context.ts');
const { emailService } = await import('../src/services/email.service.ts');
const { config } = await import('../src/config/env.config.ts');
const { discountCodes } = await import('../src/config/discount-codes.config.ts');
const { DEFAULT_EMAIL_MARKETING_CONFIG } = await import(
  '../src/services/email-marketing-settings.service.ts'
);

const languages =
  valued.get('lang') === 'en' ? ['en'] : valued.get('lang') === 'ja' ? ['ja'] : ['en', 'ja'];

const only = (valued.get('only') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const delayMs = parseInt(valued.get('delay') || '400', 10);
const usePlus = !flags.has('--no-plus');

// ---------------------------------------------------------------------------
// The configured ladder
// ---------------------------------------------------------------------------

/**
 * The reminder sequence as it is actually set up, from `email_marketing_steps`.
 *
 * Falls back to the seed rather than failing: a review of the transactional
 * designs should not be blocked because this machine cannot reach the database.
 * Which of the two was used is printed, because reviewing the seeded ladder
 * while believing it is production's is the one way this can mislead.
 */
async function loadLadder() {
  if (flags.has('--no-db')) {
    return { steps: DEFAULT_EMAIL_MARKETING_CONFIG.steps, source: 'defaults (--no-db)' };
  }

  let dataSource;

  try {
    const { AppDataSource } = await import('../src/config/database.config.ts');
    const { emailMarketingSettingsService } = await import(
      '../src/services/email-marketing-settings.service.ts'
    );

    dataSource = AppDataSource;
    if (!dataSource.isInitialized) await dataSource.initialize();

    const marketingConfig = await emailMarketingSettingsService.getConfig();

    return {
      steps: marketingConfig.steps,
      source: `database (sequence ${marketingConfig.enabled ? 'enabled' : 'disabled'})`
    };
  } catch (err) {
    console.log(`  Could not read the ladder from the database — ${err.message}`);
    return { steps: DEFAULT_EMAIL_MARKETING_CONFIG.steps, source: 'defaults (database unreachable)' };
  } finally {
    // Read once, then let go: the rest of the run talks to ZeptoMail only, and
    // an open pool would keep the process alive after the last send.
    if (dataSource?.isInitialized) await dataSource.destroy();
  }
}

const ladder = await loadLadder();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Real-looking destinations rather than the localhost in .env: whether a link
// looks right is part of what is being reviewed.
const SITE = process.env.TEST_SITE_URL || 'https://myiq-test.com';
const APP = process.env.TEST_APP_URL || 'https://boost.myiq-test.com';

/** Everything any design might read, in the language it is being sent in. */
function baseContext(language, recipient) {
  const firstName = language === 'ja' ? '太郎' : 'Yuki';
  const ja = language === 'ja';

  return createEmailContext(
    { email: recipient, language, site_url: SITE },
    {
      first_name: firstName,
      honorific_name: honorific(language, firstName),
      iq_score: 122,
      iq_band: ja ? '高い' : 'Superior',
      cta_url: `${SITE}/${language}/result?quiz_id=8421`,
      hours_since_quiz: 26,

      // The ladder's own codes — see DEFAULT_EMAIL_MARKETING_CONFIG. Overridden
      // per template below, since the rung is what the copy is written around.
      discount_code: 'K75QSQC',
      discount_percent: 20,

      login_email: recipient,
      login_password: 'K7MP-3QRT-9XYZ',
      login_url: `${APP}/login`,
      program_name: ja ? 'myIQ認知トレーニングプログラム' : 'myIQ Cognitive Training Program',

      reset_url: `${APP}/reset-password?token=review-fixture`,
      reset_expires_hours: 1,

      new_email: 'new.address@example.com',
      old_email: recipient,
      confirm_url: `${APP}/confirm-email?token=review-fixture`,
      confirm_expires_hours: 1,

      order_ref: 'myIQ_8421',
      order_date: ja ? '2026年9月20日' : '20 September 2026',
      quiz_id: '8421',
      first_sale_amount: ja ? '￥199' : '£2.99',
      cross_sale_amount: ja ? '￥1,990' : '£7.99',
      subscription_price: ja ? '￥5,495' : '£29.99',
      interval_days: 28,
      // Null, not a date: nothing currently creates a trial, and an email must
      // never announce one the customer does not have. `--variants` sends the
      // trial shape separately.
      trial_end: null,

      first_sale_report_url: `${SITE}/${language}/result?quiz_id=8421`,
      cross_sale_report_url: `${SITE}/${language}/result/report?quiz_id=8421`,

      // The one design whose reader is an operator. Its values are what a
      // stranger typed into a public form, so the fixture deliberately includes
      // the characters that would show up wrong in an unescaped design.
      contact_id: '317',
      contact_name: ja ? '山田 花子' : "Alex O'Brien & Co",
      contact_email: 'visitor@example.com',
      contact_topic: 'Billing or refunds',
      contact_message:
        'I was charged twice for the report.\n\nThe second charge is dated 20 September.\nCan you check <this> for me?',
      contact_language: language,
      contact_submitted_at: ja ? '2026年9月20日 14:32' : '20 September 2026, 14:32'
    }
  );
}

/**
 * What one configured rung puts into the context.
 *
 * Mirrors `EmailMarketingService.buildContext`: the code is upper-cased, its
 * percentage comes from data/discount-codes.json rather than from the step, and
 * the CTA points at checkout carrying `price_dis` so the customer lands on a
 * price that already has the discount in it. Reviewing a reminder means
 * checking that link as much as the copy, so it has to be the real shape.
 */
function stepOverrides(step, language) {
  const code = step.discount_code ? step.discount_code.toUpperCase() : null;
  const percent = code ? (discountCodes[code]?.discount ?? null) : null;

  const cta = new URL(`${SITE}/${language}/checkout`);
  cta.searchParams.set('quiz_id', 'review-fixture');
  if (code) cta.searchParams.set('price_dis', code);

  return {
    discount_code: code,
    discount_percent: percent,
    hours_since_quiz: Math.floor(step.delay_hours),
    cta_url: cta.toString()
  };
}

/** The shapes a design supports that the standard fixture does not show. */
const VARIANTS = [
  { tag: '', label: 'standard', overrides: {} },
  {
    tag: 'no-upsell',
    label: 'report without the career upsell',
    only: ['transactional_report_ready'],
    overrides: { cross_sale_report_url: null, cross_sale_amount: null }
  },
  {
    tag: 'returning',
    label: 'welcome for a customer who already has a password',
    only: ['transactional_welcome'],
    overrides: { login_password: null }
  },
  {
    tag: 'trial',
    label: 'welcome with a free trial',
    only: ['transactional_welcome'],
    overrides: { trial_end: '25 September 2026' }
  },
  {
    tag: 'anonymous',
    label: 'no first name captured',
    only: ['transactional_report_ready', 'marketing_reminder_day1'],
    overrides: { first_name: null }
  }
];

/**
 * The recipient, tagged so the inbox is readable.
 *
 * Six welcome emails with identical subjects are not a review, they are a pile.
 * The tag rides in the address itself, which every client shows, and which
 * Gmail and most providers deliver to the same mailbox. `--no-plus` turns it
 * off for the ones that do not.
 */
function addressFor(templateId, language, tag) {
  if (!usePlus || target.includes('+')) return target;

  const [local, domain] = target.split('@');
  const suffix = [templateId, language, tag]
    .filter(Boolean)
    .join('_')
    .replace(/[^a-zA-Z0-9_-]/g, '');

  return `${local}+${suffix}@${domain}`;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

const templates = listTemplates().filter((t) => !only.length || only.includes(t.id));

if (!templates.length) {
  console.error(`No template matched --only=${only.join(',')}`);
  console.error(`Known ids:\n  ${listTemplates().map((t) => t.id).join('\n  ')}`);
  process.exit(1);
}

/**
 * One job per thing to send.
 *
 * A marketing design is sent once per rung that points at it, not once per
 * design: the ladder is free to use one template twice at different discounts,
 * and both of those are things to look at. A marketing template no rung
 * references is still sent — it exists, so it gets reviewed — but flagged,
 * because "nothing sends this" is worth noticing during a review of what we
 * send.
 */
const jobs = [];

for (const template of templates) {
  const steps =
    template.category === 'marketing'
      ? ladder.steps.filter((s) => s.template_id === template.id)
      : [];

  const rungs =
    template.category !== 'marketing'
      ? [null]
      : steps.length
        ? steps
        : [{ key: 'unused', label: 'no step points at this template', enabled: false, delay_hours: 24, discount_code: '' }];

  for (const language of languages) {
    for (const step of rungs) {
      for (const variant of VARIANTS) {
        if (variant.tag && !flags.has('--variants')) continue;
        if (variant.only && !variant.only.includes(template.id)) continue;
        jobs.push({ template, language, variant, step });
      }
    }
  }
}

const problem = emailService.configurationProblem();
if (problem) {
  console.error(`\nCannot send: ${problem}\n`);
  process.exit(1);
}

if (!config.email.enabled) {
  console.error(
    '\nCannot send: ZEPTOMAIL_ENABLED is not true. Re-run with --dry-run to render only.\n'
  );
  process.exit(1);
}

console.log(`
  Sending ${jobs.length} email${jobs.length === 1 ? '' : 's'} to ${target}
  from      ${config.email.fromAddress}
  provider  ${config.email.apiUrl}
  ladder    ${ladder.source} — ${ladder.steps.length} step${ladder.steps.length === 1 ? '' : 's'}
  mode      ${dryRun ? 'DRY RUN — nothing leaves the machine' : 'live'}
`);

const results = [];

for (const [index, job] of jobs.entries()) {
  const { template, language, variant, step } = job;

  // Two rungs can share a design, so the step key is part of what makes this
  // message identifiable in the inbox.
  const tag = [step && step.key, variant.tag].filter(Boolean).join('_');

  const to = addressFor(template.id, language, tag);
  const context = baseContext(language, to);

  Object.assign(
    context,
    step ? stepOverrides(step, language) : {},
    variant.overrides
  );

  // The honorific carries its own fallback and is derived, not stored, so any
  // variant that changes the name has to have it recomputed.
  if ('first_name' in variant.overrides) {
    context.honorific_name = honorific(language, context.first_name);
  }

  const hosted = providerTemplateKey(template.id);
  const result = await emailService.send({
    templateId: template.id,
    to,
    toName: context.first_name,
    context
  });

  results.push({ ...job, to, result, hosted });

  const status =
    result.status === 'sent' ? 'sent' : result.status === 'skipped' ? 'skipped' : 'FAILED';
  const detail =
    result.status === 'sent'
      ? result.subject
      : result.status === 'skipped'
        ? result.reason
        : result.error;

  const label = template.id + (tag ? ':' + tag : '');

  // What the rung is set to, since checking the copy against its own discount
  // is most of the point of reviewing a reminder.
  const rung = step
    ? ` (${step.delay_hours}h, ${context.discount_percent ?? 0}%${step.enabled === false ? ', OFF' : ''})`
    : '';

  console.log(
    `  ${String(index + 1).padStart(2)}/${jobs.length}  ${language}  ` +
      `${label.padEnd(48)}${status.padEnd(8)}${hosted ? '[hosted] ' : ''}${detail}${rung}`
  );

  // ZeptoMail rate-limits, and a burst of twenty is exactly the shape that
  // trips it. The whole run still finishes in well under a minute.
  if (index < jobs.length - 1) await sleep(delayMs);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const sent = results.filter((r) => r.result.status === 'sent');
const skipped = results.filter((r) => r.result.status === 'skipped');
const failed = results.filter((r) => r.result.status === 'failed');

console.log(`
  ${sent.length} sent · ${skipped.length} skipped · ${failed.length} failed
`);

if (skipped.length) {
  console.log('  Skipped:');
  for (const r of skipped) console.log(`    ${r.template.id} (${r.language}) — ${r.result.reason}`);
  console.log('');
}

if (failed.length) {
  console.log('  Failed:');
  for (const r of failed) console.log(`    ${r.template.id} (${r.language}) — ${r.result.error}`);
  console.log('');
  process.exit(1);
}

if (usePlus && !target.includes('+')) {
  console.log('  Each message is addressed to <you>+<template>_<language>, so the inbox');
  console.log('  shows which design is which. Pass --no-plus if your mailbox rejects that.\n');
}
