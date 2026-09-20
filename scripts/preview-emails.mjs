/**
 * Renders every email to `temp/email-preview/` so they can be opened in a
 * browser and diffed against `docs/email-template-ref/`.
 *
 *   npm run preview:emails
 *
 * Renders each template twice, once per language, with representative data —
 * and renders the variants that are easy to forget: a welcome for a returning
 * customer who keeps their old password, a report with no upsell, and a welcome
 * with a trial (which nothing currently produces, but the design supports).
 *
 * Nothing is sent. This touches no database and no provider.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Run through tsx (see the npm script), which compiles the TypeScript imports
// below on the fly.
const { listTemplates, renderTemplate } = await import('../src/emails/registry.ts');
const { createEmailContext, honorific } = await import('../src/emails/context.ts');

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'temp', 'email-preview');
mkdirSync(OUT, { recursive: true });

const SITE = 'https://myiq-test.com';
const APP = 'https://boost.myiq-test.com';

/** Representative values for every parameter any design reads. */
function contextFor(language, overrides = {}) {
  const firstName = language === 'ja' ? '太郎' : 'Yuki';

  return createEmailContext(
    { email: 'customer@example.com', language, site_url: SITE },
    {
      first_name: firstName,
      honorific_name: honorific(language, firstName),
      iq_score: 122,
      iq_band: language === 'ja' ? '高い' : 'Superior',
      cta_url: SITE + '/' + language + '/result',
      hours_since_quiz: 26,
      discount_code: 'BRAIN20',
      discount_percent: 20,
      login_email: 'customer@example.com',
      login_password: 'K7MP-3QRT-9XYZ',
      login_url: APP + '/login',
      program_name: language === 'ja' ? '脳力トレーニング' : 'Cognitive Training Program',
      reset_url: APP + '/reset-password?token=preview',
      reset_expires_hours: 1,
      first_sale_report_url: SITE + '/' + language + '/result?quiz_id=preview',
      cross_sale_report_url: SITE + '/' + language + '/result/report?quiz_id=preview',
      order_ref: 'myIQ_8421',
      order_date: language === 'ja' ? '2026年9月20日' : '20 September 2026',
      quiz_id: '8421',
      first_sale_amount: language === 'ja' ? '￥199' : '£2.99',
      cross_sale_amount: language === 'ja' ? '￥1,990' : '£7.99',
      subscription_price: language === 'ja' ? '￥5,495' : '£29.99',
      interval_days: 28,
      trial_end: null,
      ...overrides
    }
  );
}

const VARIANTS = [
  { suffix: '', label: 'standard', overrides: {} },
  {
    suffix: '--no-upsell',
    label: 'report without the career upsell',
    only: ['transactional_report_ready'],
    overrides: { cross_sale_report_url: null, cross_sale_amount: null }
  },
  {
    suffix: '--returning',
    label: 'welcome for a customer who already has a password',
    only: ['transactional_welcome'],
    overrides: { login_password: null }
  },
  {
    suffix: '--trial',
    label: 'welcome with a free trial (no subscription currently creates one)',
    only: ['transactional_welcome'],
    overrides: { trial_end: '25 September 2026' }
  },
  {
    suffix: '--anonymous',
    label: 'no first name captured',
    only: ['transactional_report_ready'],
    overrides: { first_name: null, honorific_name: null }
  }
];

const index = [];
let count = 0;

for (const template of listTemplates()) {
  for (const language of ['en', 'ja']) {
    for (const variant of VARIANTS) {
      if (variant.only && !variant.only.includes(template.id)) continue;

      const ctx = contextFor(language, variant.overrides);
      if (variant.overrides.honorific_name === null) {
        ctx.honorific_name = honorific(language, null);
      }

      const { subject, html } = renderTemplate(template.id, ctx);
      const name = `${template.id}--${language}${variant.suffix}.html`;

      writeFileSync(join(OUT, name), html, 'utf8');
      index.push({ name, id: template.id, language, subject, variant: variant.label });
      count += 1;
    }
  }
}

// A contact sheet, so the whole set can be reviewed without opening 20 files.
const rows = index
  .map(
    (item) =>
      `<tr>
         <td><a href="./${item.name}" target="preview">${item.id}</a></td>
         <td>${item.language}</td>
         <td>${item.variant}</td>
         <td style="color:#5a6779">${item.subject}</td>
       </tr>`
  )
  .join('');

writeFileSync(
  join(OUT, 'index.html'),
  `<!doctype html><html><head><meta charset="utf-8"><title>Email previews</title>
   <style>
     body{font:14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;display:flex;height:100vh}
     .list{width:46%;overflow:auto;padding:20px;border-right:1px solid #e5e7eb}
     iframe{flex:1;border:0}
     table{border-collapse:collapse;width:100%}
     td{padding:7px 10px;border-bottom:1px solid #eef1f5;vertical-align:top;font-size:13px}
     a{color:#b93c2a}
     h1{font-size:16px;margin:0 0 4px}
     p{color:#5a6779;margin:0 0 16px;font-size:13px}
   </style></head>
   <body>
     <div class="list">
       <h1>Email previews</h1>
       <p>${count} renders. Compare against <code>docs/email-template-ref/</code>.</p>
       <table>${rows}</table>
     </div>
     <iframe name="preview" src="./${index[0]?.name ?? ''}"></iframe>
   </body></html>`,
  'utf8'
);

console.log(`\nRendered ${count} emails to temp/email-preview/`);
console.log(`Open temp/email-preview/index.html to review them.\n`);
for (const item of index) console.log(`  ${item.language}  ${item.id}${item.variant === 'standard' ? '' : '  (' + item.variant + ')'}`);
console.log('');
