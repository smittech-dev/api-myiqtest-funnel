import type { EmailTemplate, EmailLanguage, EmailTemplateContext } from '../email.types.js';
import {
  discountPanel,
  escapeContext,
  interpolate,
  paragraph,
  renderLayout,
  scoreLine
} from '../layout.js';

/**
 * The four abandoned-checkout designs, one per rung of the discount ladder.
 *
 * They share the layout and differ only in copy, which is the whole point: the
 * sequence is a change of tone over five days — a helpful nudge, then the case
 * for the report, then a real discount, then a last call — not four different
 * emails. Keeping the copy as data means marketing can rewrite a step without
 * going near the HTML, and a fifth rung is a new entry rather than a new file.
 *
 * Every string may use `{{param}}` placeholders drawn from EmailTemplateContext.
 */

interface Copy {
  subject: string;
  /**
   * The line shown beside the subject in the inbox list.
   *
   * Worth writing rather than leaving to the client: unset, every client pulls
   * the opening words of the body instead, which on all four of these is a
   * thank-you rather than a reason to open. It is the second thing a reader
   * sees and the cheapest thing in the email to get right.
   */
  preview: string;
  eyebrow: string;
  headline: string;
  /** Body paragraphs, in order. */
  paragraphs: string[];
  cta: string;
  footnote: string;
}

interface ReminderDefinition {
  id: string;
  name: string;
  description: string;
  copy: Record<EmailLanguage, Copy>;
}

const DEFINITIONS: ReminderDefinition[] = [
  {
    id: 'marketing_reminder_day1',
    name: 'Day 1 — your report is waiting (20% off)',
    description:
      'First nudge, ~24h after the quiz. Warm and low-pressure: the report exists, here is a small thank-you discount.',
    copy: {
      ja: {
        subject: '{{honorific_name}}の詳細IQレポートが未受け取りです',
        preview: '採点は完了しています。4分野の詳細分析と、{{discount_percent}}%OFFクーポンのご案内です。',
        eyebrow: 'レポート準備完了',
        headline: 'あなたの詳細IQレポートをお待ちしています',
        paragraphs: [
          'IQテストの受験ありがとうございました。採点は完了し、詳細レポートはいつでもお受け取りいただけます。',
          'レポートには、4分野それぞれの詳しい分析、同年代との比較、そしてあなたの強みを伸ばすための具体的な提案が含まれています。',
          'まだお受け取りでない方のために、{{discount_percent}}%OFFのクーポンをご用意しました。'
        ],
        cta: 'レポートを受け取る',
        footnote: 'クーポンは数量限定です。お早めにご利用ください。'
      },
      en: {
        subject: 'Hi {{honorific_name}}, your detailed IQ report is still waiting',
        preview: 'Your answers are scored. Inside: all four categories, your age-group comparison, and {{discount_percent}}% off.',
        eyebrow: 'Report ready',
        headline: 'Your detailed IQ report is ready to unlock',
        paragraphs: [
          'Thanks for taking the test. Your answers have been scored and your full report is ready whenever you are.',
          'It breaks your result down across all four reasoning categories, compares you to your age group, and shows where your strengths actually sit.',
          'Since you have not picked it up yet, here is {{discount_percent}}% off to make it easy.'
        ],
        cta: 'Unlock my report',
        footnote: 'This coupon is limited — use it while it lasts.'
      }
    }
  },
  {
    id: 'marketing_reminder_day2',
    name: 'Day 2 — what is inside the report (20% off)',
    description:
      'Second nudge, ~48h after the quiz. Makes the case for the report itself; same 20% code as day 1.',
    copy: {
      ja: {
        subject: 'そのIQスコアが何を意味するのか、まだご覧になっていません',
        preview: 'スコアそのものより、その内訳のほうが役に立ちます。{{discount_percent}}%OFFは間もなく終了します。',
        eyebrow: 'あと少しで完了',
        headline: 'スコアの「意味」まで、まだ見ていませんね',
        paragraphs: [
          'スコアそのものは物語の入口にすぎません。本当に役立つのは、その数字がどこから来ているかです。',
          'レポートでお伝えする内容:<br />・論理・空間・数的・言語の4分野別スコアと解説<br />・同年代・同性の受験者との比較<br />・あなたの認知的な強みと、伸ばし方の提案<br />・保存・共有できる公式認定証',
          '{{discount_percent}}%OFFクーポンは、まだ有効です。'
        ],
        cta: '詳細レポートを見る',
        footnote: 'ご購入後すぐにレポートをご覧いただけます。'
      },
      en: {
        subject: 'What your IQ score actually means',
        preview: 'The number is the least interesting part. The breakdown is where it gets useful — and {{discount_percent}}% off is still on.',
        eyebrow: 'Almost there',
        headline: 'You have the number. You have not seen what it means.',
        paragraphs: [
          'A score on its own is the beginning of the story. What is useful is knowing where that number comes from.',
          'Inside the report:<br />&bull; Category scores for logical, spatial, numerical and verbal reasoning<br />&bull; How you compare to others of your age and gender<br />&bull; Where your cognitive strengths sit, and how to build on them<br />&bull; A shareable certificate of your result',
          'Your {{discount_percent}}% discount is still valid.'
        ],
        cta: 'See my full report',
        footnote: 'Instant access — your report opens the moment you check out.'
      }
    }
  },
  {
    id: 'marketing_reminder_day3',
    name: 'Day 3 — best offer (50% off)',
    description:
      'Third nudge, ~72h after the quiz. The discount doubles to 50%; this is the step that converts most of the sequence.',
    copy: {
      ja: {
        subject: '【半額】{{honorific_name}}へ — 詳細IQレポートが{{discount_percent}}%OFF',
        preview: 'これまでで最大の割引です。ご利用は期間限定となります。',
        eyebrow: '特別割引',
        headline: '割引率を引き上げました — 今なら{{discount_percent}}%OFF',
        paragraphs: [
          'まだ受け取っていただけていないので、これまでで最も大きな割引をご用意しました。',
          '詳細レポートと公式認定証の一式が、通常価格の半額でお受け取りいただけます。',
          'これ以上の割引のご案内は予定しておりません。'
        ],
        cta: '{{discount_percent}}%OFFで受け取る',
        footnote: 'この割引はまもなく終了します。'
      },
      en: {
        subject: 'Your biggest discount yet: {{discount_percent}}% off your IQ report',
        preview: 'The largest discount we offer on the full report. It does not get better than this one.',
        eyebrow: 'Best offer',
        headline: 'We have doubled your discount — {{discount_percent}}% off',
        paragraphs: [
          'You still have not collected your report, so here is the largest discount we offer.',
          'That is the complete detailed report and your official certificate, at half the usual price.',
          'We do not plan to go lower than this.'
        ],
        cta: 'Claim {{discount_percent}}% off',
        footnote: 'This discount expires shortly.'
      }
    }
  },
  {
    id: 'marketing_reminder_day5',
    name: 'Day 5 — final call (50% off)',
    description:
      'Last nudge, ~5 days after the quiz. Closes the sequence: same 50% code, framed as the final reminder.',
    copy: {
      ja: {
        subject: '最終案内: IQレポートが{{discount_percent}}%OFF（本日まで）',
        preview: 'このクーポンは本日で終了します。レポートはその後もお受け取りいただけますが、定価となります。',
        eyebrow: '最終のご案内',
        headline: 'IQレポートに関するご連絡は、これが最後です',
        paragraphs: [
          '受験から数日が経ちました。ご興味がなければ、これ以上お送りすることはありません。',
          'ただ、採点済みのレポートはまだお手元に届いていません。{{discount_percent}}%OFFのクーポンは、このメールの間は有効です。',
          '受け取らずに終えるには、少しもったいない結果です。'
        ],
        cta: '最後にレポートを受け取る',
        footnote: 'このご案内をもって、レポートに関するメールは終了となります。'
      },
      en: {
        subject: 'Final reminder: your IQ report ({{discount_percent}}% off)',
        preview: 'Last day for this coupon. The report stays available afterwards, just at full price.',
        eyebrow: 'Last call',
        headline: 'This is the last email about your IQ report',
        paragraphs: [
          'It has been a few days since you took the test. If the report is not for you, we will stop here — this is the final reminder.',
          'Your scored report is still unclaimed, and your {{discount_percent}}% discount is still attached to it for as long as this email is open.',
          'It seems a shame to leave the result behind.'
        ],
        cta: 'Get my report',
        footnote: 'No further emails about your report will be sent after this one.'
      }
    }
  }
];

/**
 * The greeting, which is the one place the two languages genuinely diverge:
 * Japanese needs the honorific attached to the name and reads badly with a bare
 * "Hi", English needs a fallback that is not "Hi null".
 */
function greeting(language: EmailLanguage, firstName: string | null): string {
  if (language === 'ja') {
    return firstName ? firstName + 'さん、こんにちは。' : 'こんにちは。';
  }
  return firstName ? 'Hi ' + firstName + ',' : 'Hi there,';
}

/** Turns one definition into a registry entry. */
function buildTemplate(definition: ReminderDefinition): EmailTemplate {
  const { id, name, description, copy } = definition;

  return {
    id,
    name,
    description,
    category: 'marketing',
    // Declared, not inferred: the admin panel lists these, and a template hosted
    // in ZeptoMail receives exactly these keys as merge_info.
    params: [
      'first_name',
      'honorific_name',
      'iq_score',
      'discount_code',
      'discount_percent',
      'cta_url',
      'site_url',
      'email',
      // Every design in this file is marketing, so every one of them carries an
      // opt-out. Declared here as well as used below, because a ZeptoMail-hosted
      // copy of this template receives only what is declared — and an email that
      // reaches the inbox without its unsubscribe link is the failure mode this
      // list exists to prevent.
      'unsubscribe_url'
    ],
    subject: { ja: copy.ja.subject, en: copy.en.subject },
    render(ctx: EmailTemplateContext): string {
      const text = copy[ctx.language] ?? copy.ja;

      // Two interpolation passes, because the copy lands in two kinds of slot.
      // Paragraphs carry inline markup (the feature lists use <br /> and
      // &bull;) and so are injected as HTML — anything substituted into them
      // must already be escaped. Headline, eyebrow, CTA and footnote are
      // escaped wholesale by renderLayout, so those take the raw values;
      // escaping twice there would show a customer `O&#39;Brien`.
      const escaped = escapeContext(ctx);
      const asHtml = (source: string) => interpolate(source, escaped);
      const asText = (source: string) => interpolate(source, ctx);

      const body =
        paragraph(greeting(ctx.language, ctx.first_name)) +
        scoreLine(ctx.language, ctx.iq_score) +
        text.paragraphs.map((p) => paragraph(asHtml(p), { html: true })).join('');

      return renderLayout({
        language: ctx.language,
        previewText: asText(text.preview),
        eyebrow: asText(text.eyebrow),
        headline: asText(text.headline),
        body,
        actions: [{ label: asText(text.cta), url: ctx.cta_url, primary: true }],
        discountBlock: ctx.discount_code
          ? discountPanel(ctx.language, ctx.discount_code, ctx.discount_percent)
          : '',
        footnote: asText(text.footnote),
        recipientEmail: ctx.email,
        unsubscribeUrl: ctx.unsubscribe_url ?? undefined,
        siteUrl: ctx.site_url
      });
    }
  };
}

export const marketingReminderTemplates: EmailTemplate[] = DEFINITIONS.map(buildTemplate);
