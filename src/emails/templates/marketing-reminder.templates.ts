import type { EmailTemplate, EmailLanguage, EmailTemplateContext } from '../email.types.js';
import { escapeContext, interpolate, offerCard, paragraph, renderLayout } from '../layout.js';

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
 *
 * A step may be scheduled with no discount code. Every line that mentions the
 * discount therefore carries, beside it, the line sent instead when there is
 * none — so the customer never reads "% off" with no number and no offer.
 */

/** A line that mentions the discount, and the one sent when there is none. */
interface Offer {
  offer: string;
  plain: string;
}

type Line = string | Offer;

/** The version of a line to send, given whether the email carries a discount. */
function pick(line: Line, hasDiscount: boolean): string {
  if (typeof line === 'string') return line;
  return hasDiscount ? line.offer : line.plain;
}

interface Copy {
  subject: Line;
  /**
   * The line shown beside the subject in the inbox list.
   *
   * Worth writing rather than leaving to the client: unset, every client pulls
   * the opening words of the body instead, which on all four of these is a
   * thank-you rather than a reason to open. It is the second thing a reader
   * sees and the cheapest thing in the email to get right.
   */
  preview: Line;
  eyebrow: Line;
  headline: Line;
  /**
   * The small line above the percent in the offer card. Only rendered when the
   * send carries a discount, so it needs no plain version.
   */
  offerLabel: string;
  /** Body paragraphs, in order. */
  paragraphs: Line[];
  /**
   * Kept to about twenty characters: the same label sits inside the offer
   * card, which leaves under 200px for it on a 375px phone. The offer
   * versions join the percent to "off" with a no-break space, so a label that
   * does wrap never strands "off" on a line of its own.
   */
  cta: Line;
  footnote: Line;
}

/**
 * The offer card's fixed lines, the same on every rung.
 *
 * `note` exists because the code is never printed: a reader shown "20% OFF"
 * and no code goes looking for one, and the answer is that the button
 * already carries it.
 */
const OFFER_COPY: Record<EmailLanguage, { subline: string; note: string }> = {
  ja: {
    subline: '詳細IQレポート＋公式認定証が対象',
    note: 'ボタンから進むだけで自動的に適用されます。コードの入力は不要です。'
  },
  en: {
    subline: 'on your detailed IQ report and official certificate',
    note: 'Applied automatically at checkout — no code needed.'
  }
};

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
        subject: {
          offer: '【{{discount_percent}}%OFF】{{honorific_name}}の詳細IQレポートが未受け取りです',
          plain: '{{honorific_name}}の詳細IQレポートが未受け取りです'
        },
        preview: {
          offer: '採点は完了しています。4分野の詳細分析と、{{discount_percent}}%OFFクーポンのご案内です。',
          plain: '採点は完了しています。4分野の詳細分析と、同年代との比較をご覧いただけます。'
        },
        eyebrow: 'レポート準備完了',
        headline: 'あなたの詳細IQレポートをお待ちしています',
        offerLabel: '受験いただいたお礼に',
        paragraphs: [
          'IQテストの受験ありがとうございました。採点は完了し、詳細レポートはいつでもお受け取りいただけます。',
          'レポートには、4分野それぞれの詳しい分析、同年代との比較、そしてあなたの強みを伸ばすための具体的な提案が含まれています。',
          {
            offer: 'まだお受け取りでない方のために、{{discount_percent}}%OFFのクーポンをご用意しました。',
            plain: '下のボタンから、すぐにレポートをお受け取りいただけます。'
          }
        ],
        cta: { offer: '{{discount_percent}}%OFFで受け取る', plain: 'レポートを受け取る' },
        footnote: {
          offer: 'クーポンは数量限定です。お早めにご利用ください。',
          plain: 'ご購入後すぐにレポートをご覧いただけます。'
        }
      },
      en: {
        // The percent leads: a phone shows the first forty-odd characters.
        subject: {
          offer: 'Hi {{honorific_name}}, {{discount_percent}}% off your IQ report — it is still waiting',
          plain: 'Hi {{honorific_name}}, your detailed IQ report is still waiting'
        },
        preview: {
          offer: 'Your answers are scored. Inside: all four categories, your age-group comparison, and {{discount_percent}}% off.',
          plain: 'Your answers are scored. Inside: all four categories and how you compare to your age group.'
        },
        eyebrow: 'Report ready',
        headline: 'Your detailed IQ report is ready to unlock',
        offerLabel: 'Your thank-you discount',
        paragraphs: [
          'Thanks for taking the test. Your answers have been scored and your full report is ready whenever you are.',
          'It breaks your result down across all four reasoning categories, compares you to your age group, and shows where your strengths actually sit.',
          {
            offer: 'Since you have not picked it up yet, here is {{discount_percent}}% off to make it easy.',
            plain: 'It takes a moment to unlock, and it is yours to keep.'
          }
        ],
        cta: { offer: 'Claim my {{discount_percent}}% off', plain: 'Unlock my report' },
        footnote: {
          offer: 'This coupon is limited — use it while it lasts.',
          plain: 'Instant access — your report opens the moment you check out.'
        }
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
        subject: {
          offer: '【{{discount_percent}}%OFF継続中】そのIQスコアが何を意味するのか、まだご覧になっていません',
          plain: 'そのIQスコアが何を意味するのか、まだご覧になっていません'
        },
        preview: {
          offer: 'スコアそのものより、その内訳のほうが役に立ちます。{{discount_percent}}%OFFは間もなく終了します。',
          plain: 'スコアそのものより、その内訳のほうが役に立ちます。'
        },
        eyebrow: 'あと少しで完了',
        headline: 'スコアの「意味」まで、まだ見ていませんね',
        offerLabel: '割引はまだご利用いただけます',
        paragraphs: [
          'スコアそのものは物語の入口にすぎません。本当に役立つのは、その数字がどこから来ているかです。',
          'レポートでお伝えする内容:<br />・論理・空間・数的・言語の4分野別スコアと解説<br />・同年代・同性の受験者との比較<br />・あなたの認知的な強みと、伸ばし方の提案<br />・保存・共有できる公式認定証',
          {
            offer: '{{discount_percent}}%OFFクーポンは、まだ有効です。',
            plain: 'レポートは、いつでもお受け取りいただけます。'
          }
        ],
        cta: { offer: '{{discount_percent}}%OFFでレポートを見る', plain: '詳細レポートを見る' },
        footnote: 'ご購入後すぐにレポートをご覧いただけます。'
      },
      en: {
        subject: {
          offer: 'Still {{discount_percent}}% off — see what your IQ score actually means',
          plain: 'What your IQ score actually means'
        },
        preview: {
          offer: 'The number is the least interesting part. The breakdown is where it gets useful — and {{discount_percent}}% off is still on.',
          plain: 'The number is the least interesting part. The breakdown is where it gets useful.'
        },
        eyebrow: 'Almost there',
        headline: 'You have the number. You have not seen what it means.',
        offerLabel: 'Your discount is still on',
        paragraphs: [
          'A score on its own is the beginning of the story. What is useful is knowing where that number comes from.',
          'Inside the report:<br />&bull; Category scores for logical, spatial, numerical and verbal reasoning<br />&bull; How you compare to others of your age and gender<br />&bull; Where your cognitive strengths sit, and how to build on them<br />&bull; A shareable certificate of your result',
          {
            offer: 'Your {{discount_percent}}% discount is still valid.',
            plain: 'Your report is ready whenever you are.'
          }
        ],
        cta: { offer: 'Get my {{discount_percent}}% off', plain: 'See my full report' },
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
        subject: {
          // The number, not 半額: the percent is set per step in the admin,
          // and "half price" is only true while that setting is 50.
          offer: '【{{discount_percent}}%OFF】{{honorific_name}}へ — これまでで最大の割引です',
          plain: '{{honorific_name}}の詳細IQレポート、まだお受け取りいただけます'
        },
        preview: {
          offer: '詳細IQレポートが{{discount_percent}}%OFF。これまでで最大の割引です。ご利用は期間限定となります。',
          plain: '採点済みのレポートと公式認定証を、今すぐお受け取りいただけます。'
        },
        eyebrow: { offer: '特別割引', plain: 'レポートのご案内' },
        headline: {
          offer: '割引率を引き上げました — 今なら{{discount_percent}}%OFF',
          plain: 'あなたの詳細レポートは、まだここにあります'
        },
        offerLabel: 'これまでで最大の割引',
        paragraphs: [
          {
            offer: 'まだ受け取っていただけていないので、これまでで最も大きな割引をご用意しました。',
            plain: 'まだ受け取っていただけていないようなので、改めてご案内いたします。'
          },
          {
            offer: '詳細レポートと公式認定証の一式が、通常価格から{{discount_percent}}%OFFでお受け取りいただけます。',
            plain: '詳細レポートと公式認定証の一式を、ご購入後すぐにお受け取りいただけます。'
          },
          {
            offer: 'これ以上の割引のご案内は予定しておりません。',
            plain: '4分野の分析と同年代との比較で、スコアの意味がはっきりとわかります。'
          }
        ],
        cta: { offer: '{{discount_percent}}%OFFで受け取る', plain: 'レポートを受け取る' },
        footnote: {
          offer: 'この割引はまもなく終了します。',
          plain: 'ご購入後すぐにレポートをご覧いただけます。'
        }
      },
      en: {
        subject: {
          offer: 'Your biggest discount yet: {{discount_percent}}% off your IQ report',
          plain: 'Your IQ report is still waiting for you'
        },
        preview: {
          offer: '{{discount_percent}}% off — the largest discount we offer on the full report. It does not get better than this one.',
          plain: 'Your scored report and certificate are ready to unlock today.'
        },
        eyebrow: { offer: 'Best offer', plain: 'Still waiting' },
        headline: {
          // "Raised", not "doubled": 20 to 50 is not double, and both numbers
          // are admin settings that can change without this copy changing.
          offer: 'We have raised your discount — now {{discount_percent}}% off',
          plain: 'Your full report is still here'
        },
        offerLabel: 'Our biggest discount',
        paragraphs: [
          {
            offer: 'You still have not collected your report, so here is the largest discount we offer.',
            plain: 'You still have not collected your report, so here is a quick reminder that it is ready.'
          },
          {
            offer: 'That is the complete detailed report and your official certificate, at {{discount_percent}}% off the usual price.',
            plain: 'That is the complete detailed report and your official certificate, yours the moment you check out.'
          },
          {
            offer: 'We do not plan to go lower than this.',
            plain: 'The category breakdown and age-group comparison are what turn the number into something useful.'
          }
        ],
        cta: { offer: 'Claim {{discount_percent}}% off', plain: 'Get my report' },
        footnote: {
          offer: 'This discount expires shortly.',
          plain: 'Instant access — your report opens the moment you check out.'
        }
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
        subject: {
          offer: '最終案内: IQレポートが{{discount_percent}}%OFF（本日まで）',
          plain: '最終案内: あなたのIQレポートについて'
        },
        preview: {
          offer: '{{discount_percent}}%OFFクーポンは本日で終了します。レポートはその後もお受け取りいただけますが、定価となります。',
          plain: 'レポートに関するご案内は、これが最後となります。'
        },
        eyebrow: '最終のご案内',
        headline: 'IQレポートに関するご連絡は、これが最後です',
        offerLabel: '最後のご案内',
        paragraphs: [
          '受験から数日が経ちました。ご興味がなければ、これ以上お送りすることはありません。',
          {
            offer: 'ただ、採点済みのレポートはまだお手元に届いていません。{{discount_percent}}%OFFのクーポンは、このメールの間は有効です。',
            plain: 'ただ、採点済みのレポートはまだお手元に届いていません。'
          },
          '受け取らずに終えるには、少しもったいない結果です。'
        ],
        cta: { offer: '{{discount_percent}}%OFFで受け取る', plain: '最後にレポートを受け取る' },
        footnote: 'このご案内をもって、レポートに関するメールは終了となります。'
      },
      en: {
        subject: {
          offer: 'Final reminder: {{discount_percent}}% off your IQ report',
          plain: 'Final reminder: your IQ report'
        },
        preview: {
          offer: 'Last day for your {{discount_percent}}% discount. The report stays available afterwards, just at full price.',
          plain: 'This is the last email we will send about your report.'
        },
        eyebrow: 'Last call',
        headline: 'This is the last email about your IQ report',
        offerLabel: 'Final reminder',
        paragraphs: [
          'It has been a few days since you took the test. If the report is not for you, we will stop here — this is the final reminder.',
          {
            offer: 'Your scored report is still unclaimed, and your {{discount_percent}}% discount is still attached to it for as long as this email is open.',
            plain: 'Your scored report is still unclaimed, and it is ready whenever you want it.'
          },
          'It seems a shame to leave the result behind.'
        ],
        cta: { offer: 'Get my {{discount_percent}}% off', plain: 'Get my report' },
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
    //
    // No `iq_score` and no `discount_code`, on purpose. The score is only
    // revealed once the report is paid for, so a reminder that prints it gives
    // away the thing it is selling. The code is never shown because it does not
    // need to be: cta_url carries it as `price_dis`, and checkout applies it.
    params: [
      'first_name',
      'honorific_name',
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
    subject: { ja: pick(copy.ja.subject, true), en: pick(copy.en.subject, true) },
    subjectWithoutDiscount: { ja: pick(copy.ja.subject, false), en: pick(copy.en.subject, false) },
    render(ctx: EmailTemplateContext): string {
      // Keyed on the percent, not the code: the percent is what the copy
      // prints, and a code missing from data/discount-codes.json resolves to
      // none.
      const hasDiscount = ctx.discount_percent !== null;
      const source = copy[ctx.language] ?? copy.ja;
      const text = {
        preview: pick(source.preview, hasDiscount),
        eyebrow: pick(source.eyebrow, hasDiscount),
        headline: pick(source.headline, hasDiscount),
        paragraphs: source.paragraphs.map((p) => pick(p, hasDiscount)),
        cta: pick(source.cta, hasDiscount),
        footnote: pick(source.footnote, hasDiscount)
      };

      // Two interpolation passes, because the copy lands in two kinds of slot.
      // Paragraphs carry inline markup (the feature lists use <br /> and
      // &bull;) and so are injected as HTML — anything substituted into them
      // must already be escaped. Headline, eyebrow, CTA and footnote are
      // escaped wholesale by renderLayout, so those take the raw values;
      // escaping twice there would show a customer `O&#39;Brien`.
      const escaped = escapeContext(ctx);
      const asHtml = (source: string) => interpolate(source, escaped);
      const asText = (source: string) => interpolate(source, ctx);

      const cta = { label: asText(text.cta), url: ctx.cta_url, primary: true };

      // The offer goes directly under the headline rather than after the
      // letter, because on a phone the letter fills the first screen and an
      // offer below it is an offer most readers never reach. The button at the
      // bottom stays, for whoever reads to the end first.
      const offer =
        ctx.discount_percent !== null
          ? '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' +
            '<tr><td style="padding:6px 0 26px 0;">' +
            offerCard(ctx.language, {
              label: source.offerLabel,
              percent: ctx.discount_percent,
              subline: OFFER_COPY[ctx.language].subline,
              cta,
              note: OFFER_COPY[ctx.language].note
            }) +
            '</td></tr></table>'
          : '';

      const body =
        offer +
        paragraph(greeting(ctx.language, ctx.first_name)) +
        text.paragraphs.map((p) => paragraph(asHtml(p), { html: true })).join('');

      return renderLayout({
        language: ctx.language,
        previewText: asText(text.preview),
        eyebrow: asText(text.eyebrow),
        headline: asText(text.headline),
        body,
        actions: [cta],
        footnote: asText(text.footnote),
        recipientEmail: ctx.email,
        unsubscribeUrl: ctx.unsubscribe_url ?? undefined,
        siteUrl: ctx.site_url
      });
    }
  };
}

export const marketingReminderTemplates: EmailTemplate[] = DEFINITIONS.map(buildTemplate);
