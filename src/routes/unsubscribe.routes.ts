import { Router, Request, Response } from 'express';
import type { EmailLanguage } from '../emails/email.types.js';
import {
  customerForToken,
  resubscribeCustomer,
  unsubscribeCustomer
} from '../services/email-unsubscribe.service.js';
import { logger } from '../utils/logger.util.js';

/**
 * The page an unsubscribe link opens.
 *
 * Served by this process rather than by the funnel bundle for one reason: it
 * has to work when nothing else does. A recipient who wants out should not be
 * blocked by a frontend deploy, a CDN, or JavaScript that did not load — the
 * whole page is one server-rendered form and a button.
 *
 * ## Why GET does not unsubscribe
 *
 * Corporate mail security — Proofpoint, Mimecast, Outlook SafeLinks — opens
 * every URL in every message before the recipient sees it. A GET that opted
 * someone out would opt out everyone behind such a gateway, silently, without a
 * human ever clicking. So GET renders a page with a button and POST does the
 * work: scanners issue GETs, people issue the POST.
 *
 * Mounted before the funnel's `x-api-key` guard, because the caller is a mail
 * client following a link and has no key to send.
 */
const router = Router();

/* ── the page ─────────────────────────────────────────────────────────────── */

const PALETTE = {
  canvas: '#f2f5f9',
  card: '#ffffff',
  navy: '#12294a',
  ink: '#101826',
  muted: '#5a6779',
  coral: '#e8654f',
  line: 'rgba(18,41,74,0.12)'
};

type PageState = 'confirm' | 'done' | 'resubscribed' | 'invalid';

interface Copy {
  title: Record<PageState, string>;
  lede: Record<PageState, string>;
  confirmButton: string;
  resubscribeButton: string;
  keepReceiving: string;
  backToSite: string;
  brandTag: string;
}

const COPY: Record<EmailLanguage, Copy> = {
  en: {
    title: {
      confirm: 'Unsubscribe from marketing email?',
      done: 'You have been unsubscribed',
      resubscribed: 'You are subscribed again',
      invalid: 'This link is not valid'
    },
    lede: {
      confirm:
        'We will stop sending offers, reminders and anything else promotional to this address.',
      done: 'No more marketing email will be sent to this address.',
      resubscribed: 'Offers and reminders will start arriving at this address again.',
      invalid:
        'The link may have been cut in half by your email client, or it may not be ours. Write to support@myiq-test.com and a person will take you off the list.'
    },
    confirmButton: 'Unsubscribe me',
    resubscribeButton: 'Actually, keep me subscribed',
    // The single most common support ticket an unsubscribe page causes is
    // "I unsubscribed and you still emailed me" — about a receipt. Said here,
    // before it happens, it is a fact; said afterwards it sounds like an excuse.
    keepReceiving:
      'You will still receive receipts, password resets and other emails about your account. Those are not marketing, and we cannot turn them off while you hold an account.',
    backToSite: 'Return to myiq-test.com',
    brandTag: 'Email preferences'
  },
  ja: {
    title: {
      confirm: 'マーケティングメールの配信を停止しますか？',
      done: '配信を停止しました',
      resubscribed: '配信を再開しました',
      invalid: 'このリンクは無効です'
    },
    lede: {
      confirm:
        'このメールアドレス宛のキャンペーン、リマインダーなどの宣伝メールの配信を停止します。',
      done: 'このメールアドレス宛のマーケティングメールは今後送信されません。',
      resubscribed: 'このメールアドレス宛にキャンペーンやリマインダーを再びお送りします。',
      invalid:
        'メールソフトによってリンクが途中で切れている可能性があります。support@myiq-test.com までご連絡いただければ、担当者が配信停止の手続きをいたします。'
    },
    confirmButton: '配信を停止する',
    resubscribeButton: 'やはり配信を続ける',
    keepReceiving:
      '領収書、パスワードの再設定、アカウントに関するお知らせは引き続きお送りします。これらはマーケティングメールではないため、アカウントをお持ちの間は停止できません。',
    backToSite: 'myiq-test.com へ戻る',
    brandTag: 'メール配信設定'
  }
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** `lang` off the query string, defaulting to English rather than guessing. */
const languageOf = (req: Request): EmailLanguage => (req.query.lang === 'ja' ? 'ja' : 'en');

function renderPage(opts: {
  language: EmailLanguage;
  state: PageState;
  email?: string | null;
  token?: string;
}): string {
  const { language, state, email, token } = opts;
  const copy = COPY[language];
  const stack =
    language === 'ja'
      ? "'Hiragino Kaku Gothic ProN','Hiragino Sans','Yu Gothic',Meiryo,sans-serif"
      : "'Helvetica Neue',Helvetica,Arial,sans-serif";

  const addressLine = email
    ? `<p style="margin:0 0 24px; font-size:15px; font-weight:700; color:${PALETTE.navy}; word-break:break-all;">${escapeHtml(email)}</p>`
    : '';

  // One form per action, so the page needs no JavaScript at all.
  const action = (label: string, path: string, primary: boolean) =>
    `<form method="post" action="/email/${path}" style="margin:0;">` +
    `<input type="hidden" name="t" value="${escapeHtml(token ?? '')}" />` +
    `<input type="hidden" name="lang" value="${language}" />` +
    `<button type="submit" style="display:block; width:100%; cursor:pointer; padding:14px 24px; ` +
    `font-family:inherit; font-size:15px; font-weight:700; border-radius:999px; ` +
    (primary
      ? `border:0; background:${PALETTE.coral}; color:#ffffff;`
      : `border:1px solid ${PALETTE.line}; background:transparent; color:${PALETTE.muted};`) +
    `">${escapeHtml(label)}</button></form>`;

  const actions =
    state === 'confirm'
      ? action(copy.confirmButton, 'unsubscribe', true)
      : state === 'done'
        ? action(copy.resubscribeButton, 'resubscribe', false)
        : '';

  const note =
    state === 'invalid'
      ? ''
      : `<p style="margin:24px 0 0; padding-top:20px; border-top:1px solid ${PALETTE.line}; font-size:13px; line-height:21px; color:${PALETTE.muted};">${escapeHtml(copy.keepReceiving)}</p>`;

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(copy.title[state])} · myIQ Test</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; padding:24px 16px; background:${PALETTE.canvas}; font-family:${stack};
         color:${PALETTE.ink}; display:flex; min-height:100vh; box-sizing:border-box;
         align-items:center; justify-content:center; }
  .card { width:100%; max-width:480px; background:${PALETTE.card}; border-radius:16px;
          padding:36px 32px; box-sizing:border-box; }
  .tag { margin:0 0 10px; font-size:11px; font-weight:700; letter-spacing:1.8px;
         text-transform:uppercase; color:${PALETTE.coral}; }
  h1 { margin:0 0 12px; font-size:23px; line-height:31px; letter-spacing:-0.4px; }
  .lede { margin:0 0 20px; font-size:15px; line-height:25px; color:${PALETTE.muted}; }
  a { color:${PALETTE.navy}; }
  /* The page is one card of dark text on a pale card; a client or OS in dark
     mode inverts the canvas and leaves the text where it was. Same problem the
     emails have, same fix. */
  @media (prefers-color-scheme: dark) {
    body { background:#0b1220; color:#eef2f7; }
    .card { background:#141c2b; }
    .lede, .card p { color:#c2cbd8 !important; }
    h1, .card strong { color:#eef2f7 !important; }
    a { color:#9db6dd; }
  }
</style>
</head>
<body>
  <main class="card">
    <p class="tag">${escapeHtml(copy.brandTag)}</p>
    <h1>${escapeHtml(copy.title[state])}</h1>
    <p class="lede">${escapeHtml(copy.lede[state])}</p>
    ${addressLine}
    ${actions}
    ${note}
    <p style="margin:20px 0 0; font-size:13px;"><a href="https://myiq-test.com/${language}">${escapeHtml(copy.backToSite)}</a></p>
  </main>
</body>
</html>`;
}

/** The token, from wherever this request carries it. */
const tokenOf = (req: Request): string =>
  String((req.method === 'POST' ? req.body?.t : req.query.t) ?? '').trim();

/* ── routes ───────────────────────────────────────────────────────────────── */

/**
 * GET — shows the confirmation, changes nothing.
 *
 * `Cache-Control: no-store` so a proxy does not hand a stale "you are
 * unsubscribed" page to the next person on the same link.
 */
router.get('/unsubscribe', async (req: Request, res: Response) => {
  const language = languageOf(req);
  const token = tokenOf(req);

  res.set('Cache-Control', 'no-store');

  try {
    const customer = await customerForToken(token);

    if (!customer) {
      res.status(404).type('html').send(renderPage({ language, state: 'invalid' }));
      return;
    }

    // Already opted out — show the confirmation rather than asking again, so a
    // second click on an older email reads as "yes, you are off the list".
    const state: PageState = customer.marketing_unsubscribed_at ? 'done' : 'confirm';

    res.type('html').send(renderPage({ language, state, email: customer.email, token }));
  } catch (error: any) {
    logger.error(`Unsubscribe page failed: ${error?.message ?? error}`);
    res.status(500).type('html').send(renderPage({ language, state: 'invalid' }));
  }
});

/** POST — the actual opt-out. */
router.post('/unsubscribe', async (req: Request, res: Response) => {
  const language = req.body?.lang === 'ja' ? 'ja' : languageOf(req);
  const token = tokenOf(req);

  res.set('Cache-Control', 'no-store');

  try {
    const customer = await customerForToken(token);

    if (!customer) {
      res.status(404).type('html').send(renderPage({ language, state: 'invalid' }));
      return;
    }

    const outcome = await unsubscribeCustomer(customer, 'email_link');

    res
      .type('html')
      .send(renderPage({ language, state: 'done', email: outcome.email, token }));
  } catch (error: any) {
    logger.error(`Unsubscribe failed: ${error?.message ?? error}`);
    res.status(500).type('html').send(renderPage({ language, state: 'invalid' }));
  }
});

/** POST — the undo, for the misclick. */
router.post('/resubscribe', async (req: Request, res: Response) => {
  const language = req.body?.lang === 'ja' ? 'ja' : languageOf(req);
  const token = tokenOf(req);

  res.set('Cache-Control', 'no-store');

  try {
    const customer = await customerForToken(token);

    if (!customer) {
      res.status(404).type('html').send(renderPage({ language, state: 'invalid' }));
      return;
    }

    const outcome = await resubscribeCustomer(customer);

    res
      .type('html')
      .send(renderPage({ language, state: 'resubscribed', email: outcome.email, token }));
  } catch (error: any) {
    logger.error(`Resubscribe failed: ${error?.message ?? error}`);
    res.status(500).type('html').send(renderPage({ language, state: 'invalid' }));
  }
});

export default router;
