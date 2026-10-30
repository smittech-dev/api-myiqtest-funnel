import type { EmailTemplate, EmailLanguage, EmailTemplateContext, EmailTemplateParam } from '../email.types.js';
import { button, escapeContext, interpolate, offerCard, paragraph, renderLayout } from '../layout.js';

/**
 * The four abandoned-checkout designs, one per rung of the ladder — the admin
 * panel lists them as Template 1 to 4.
 *
 * They share the layout and differ only in copy: two plain reminders that the
 * report is ready, then a 20% offer, then a 50% one. Keeping the copy as data
 * means marketing can rewrite a step without going near the HTML, and a fifth
 * rung is a new entry rather than a new file.
 *
 * Each email reads as a short letter — greeting, paragraphs, the button, one
 * closing line — with no headline around it, so what the customer receives is
 * exactly the copy marketing wrote. The one addition is the discount box: the
 * two plain reminders were written without an offer, and when their step
 * carries a code anyway, the box takes the button's place.
 *
 * Every string may use `{{param}}` placeholders drawn from EmailTemplateContext.
 * Paragraphs and the closing line are injected as HTML, which is how the
 * emphasised phrases carry their `<strong>`.
 */

const INK = '#101826';

interface Copy {
  subject: string;
  /**
   * The line shown beside the subject in the inbox list.
   *
   * Worth writing rather than leaving to the client: unset, every client pulls
   * the opening words of the body instead, which is the greeting.
   */
  preview: string;
  /** Body paragraphs above the button, in order. */
  paragraphs: string[];
  cta: string;
  /** The line under the button. */
  closing: string;
}

interface ReminderDefinition {
  id: string;
  name: string;
  description: string;
  /**
   * Whether the copy prints the discount.
   *
   * Such a design has no version for going out without one, so the settings
   * save refuses to schedule it on "No discount". A design without an offer
   * says nothing about price; a code attached to its step still rides in the
   * button's link and applies at checkout.
   */
  offer: boolean;
  copy: Record<EmailLanguage, Copy>;
  /**
   * For a design written without an offer: the inbox lines it sends instead
   * when its step carries a code, with the discount box in the letter.
   *
   * Its presence is what gives the design two versions — the copy above on
   * "No discount", this and the box with a code — and so what lets the
   * settings save accept either.
   */
  withDiscount?: Record<EmailLanguage, Pick<Copy, 'subject' | 'preview'>>;
}

/**
 * The discount box, one for every design with a `withDiscount` version, so the
 * offer reads the same whichever rung it rides on.
 *
 * It carries the button, which is why it replaces it rather than sitting above
 * it: the letter still has exactly one thing to click. The button is labelled
 * by the box rather than by the design, so it reads the same on every rung.
 * The percent and never the code — see the note on params in buildTemplate.
 */
const DISCOUNT_BOX: Record<
  EmailLanguage,
  { label: string; subline: string; cta: string; note: string }
> = {
  ja: {
    label: '特別オファー',
    subline: 'あなた専用のノウミライレポートに適用されます',
    cta: 'ノウミライレポートを受け取る — {{discount_percent}}%オフ',
    note: 'クーポンコードの入力は不要です。割引はお支払い画面で自動的に適用されます。'
  },
  en: {
    label: 'Special offer',
    subline: 'on your personalized NOUMIRAI Report',
    // A no-break space keeps "Save 20%" together when the button wraps on a
    // phone.
    cta: 'Unlock NOUMIRAI Report — Save {{discount_percent}}%',
    note: 'No code needed — the discount is applied automatically at checkout.'
  }
};

const DEFINITIONS: ReminderDefinition[] = [
  {
    id: 'marketing_reminder_1',
    name: 'Template 1 — Your NOUMIRAI results are ready to be unlocked!',
    description:
      'First nudge, ~24h after the quiz: the report is ready and one click away. Works with or without a code — with one, the discount box replaces the button.',
    offer: false,
    withDiscount: {
      ja: {
        subject: '【{{discount_percent}}%オフ】ノウミライの結果をご確認いただける準備が整いました！',
        preview: 'あなた専用のノウミライレポートを、今なら{{discount_percent}}%オフでお受け取りいただけます。'
      },
      en: {
        subject: 'Your NOUMIRAI results are ready — unlock them for {{discount_percent}}% off!',
        preview: 'Your personalized NOUMIRAI Report is waiting, now {{discount_percent}}% off.'
      }
    },
    copy: {
      ja: {
        subject: 'ノウミライの結果をご確認いただける準備が整いました！',
        preview: 'あなた専用のノウミライレポートをご用意しています。',
        paragraphs: [
          'IQクイズの受験が完了しました。いよいよ、あなたの結果を詳しく知るときです！',
          'あなた専用の<strong>ノウミライレポート</strong>をご用意しています。レポートを受け取って結果を詳しく確認し、あなたの認知的な強みについての洞察を得てください。',
          '<strong>次のステップは、ワンクリックで完了します。</strong>'
        ],
        cta: 'ノウミライレポートを受け取る',
        closing: '結果をそのままにしておくのはもったいない。あなた専用のレポートの内容を、ぜひご覧ください！'
      },
      en: {
        subject: 'Your NOUMIRAI results are ready to be unlocked!',
        preview: 'Your personalized NOUMIRAI Report is waiting for you.',
        paragraphs: [
          'You’ve completed your IQ quiz — now it’s time to discover more about your results!',
          'Your personalized <strong>NOUMIRAI Report</strong> is waiting for you. Unlock your report to explore your results and gain insights into your cognitive strengths.',
          '<strong>Your next step is just one click away.</strong>'
        ],
        cta: 'Unlock NOUMIRAI Report',
        closing: 'Don’t leave your results waiting. Discover what your personalized report has to offer!'
      }
    }
  },
  {
    id: 'marketing_reminder_2',
    name: 'Template 2 — Ready to discover more about your NOUMIRAI results?',
    description:
      'Second nudge, ~48h after the quiz: the quiz was only the beginning, the report is the rest. Works with or without a code — with one, the discount box replaces the button.',
    offer: false,
    withDiscount: {
      ja: {
        subject: '【{{discount_percent}}%オフ】ノウミライの結果を、もっと詳しく知りませんか？',
        preview: 'あなた専用のノウミライレポートを、今なら{{discount_percent}}%オフでお受け取りいただけます。'
      },
      en: {
        subject: 'Ready to discover more? Unlock your NOUMIRAI Report for {{discount_percent}}% off',
        preview: 'Your personalized NOUMIRAI Report is ready to unlock, now {{discount_percent}}% off.'
      }
    },
    copy: {
      ja: {
        subject: 'ノウミライの結果を、もっと詳しく知りませんか？',
        preview: 'あなた専用のノウミライレポートは、いつでもお受け取りいただけます。',
        paragraphs: [
          'ノウミライクイズの受験は完了しましたが、まだ知っていただきたいことがあります！',
          'あなた専用のノウミライレポートは、いつでもお受け取りいただけます。結果をより詳しく確認し、ご自身の認知能力への理解を深めるための洞察をご覧ください。',
          '<strong>クイズは、ほんの始まりにすぎません。</strong>',
          '次のステップへ進み、今日レポートを受け取りましょう。'
        ],
        cta: 'ノウミライレポートを受け取る',
        closing: 'あなたの結果は、いつでもお待ちしています。'
      },
      en: {
        subject: 'Ready to discover more about your NOUMIRAI results?',
        preview: 'Your personalized NOUMIRAI Report is ready to unlock.',
        paragraphs: [
          'You’ve completed your NOUMIRAI quiz, but there’s more to discover!',
          'Your personalized NOUMIRAI Report is ready to unlock. Get a closer look at your results and explore insights designed to help you better understand your cognitive abilities.',
          '<strong>Your quiz was just the beginning.</strong>',
          'Take the next step and unlock your report today.'
        ],
        cta: 'Unlock NOUMIRAI Report',
        closing: 'Your results are waiting whenever you’re ready.'
      }
    }
  },
  {
    // The percent is the step's code, never written into the copy: it is set
    // per step in the admin, and the email must say what checkout applies.
    id: 'marketing_reminder_3',
    name: 'Template 3 — A special offer: Get 20% off your NOUMIRAI Report!',
    description:
      'Third nudge, ~72h after the quiz. The first discount of the sequence; needs a code (20% by default).',
    offer: true,
    copy: {
      ja: {
        subject: '【特別オファー】ノウミライレポートが{{discount_percent}}%OFF！',
        preview: '期間限定で、あなた専用のノウミライレポートが{{discount_percent}}%OFFになります。',
        paragraphs: [
          'IQクイズの受験が完了しました。いよいよ、あなたの結果を確かめるときです！',
          '期間限定で、<strong>あなた専用のノウミライレポートが{{discount_percent}}%OFF</strong>。認知的な強みを理解するための次のステップへ進みましょう。',
          'レポートでは、クイズの結果に基づいたあなただけの洞察をお届けし、ご自身のパフォーマンスをより深く知ることができます。',
          '<strong>あなたの結果が待っています。今なら、よりお得に受け取れます。</strong>'
        ],
        cta: 'ノウミライレポートを受け取る — {{discount_percent}}%OFF',
        closing: 'クイズをもっと活かせるこの機会を、お見逃しなく。'
      },
      en: {
        subject: 'A special offer: Get {{discount_percent}}% off your NOUMIRAI Report!',
        preview: 'For a limited time, enjoy {{discount_percent}}% OFF your personalized NOUMIRAI Report.',
        paragraphs: [
          'You’ve completed your IQ quiz — now it’s time to explore your results!',
          'For a limited time, enjoy <strong>{{discount_percent}}% OFF your personalized NOUMIRAI Report</strong> and take the next step toward understanding your cognitive strengths.',
          'Your report offers personalized insights based on your quiz results, helping you learn more about your performance.',
          '<strong>Your results are waiting, and now you can unlock them for less.</strong>'
        ],
        // A no-break space keeps "Save 20%" together when the button wraps on
        // a phone.
        cta: 'Unlock NOUMIRAI Report — Save {{discount_percent}}%',
        closing: 'Don’t miss this opportunity to get more from your quiz.'
      }
    }
  },
  {
    id: 'marketing_reminder_4',
    name: 'Template 4 — Your exclusive offer: 50% off your NOUMIRAI Report!',
    description:
      'Last nudge, ~5 days after the quiz. The biggest discount, closing the sequence; needs a code (50% by default).',
    offer: true,
    copy: {
      ja: {
        subject: '【あなただけの特別オファー】ノウミライレポートが{{discount_percent}}%OFF！',
        preview: '期間限定で、あなた専用のノウミライレポートが{{discount_percent}}%OFFになります。',
        paragraphs: [
          'IQクイズの受験が完了しました。あなた専用の結果は、今もお受け取りをお待ちしています。',
          '期間限定で、<strong>あなた専用のノウミライレポートが{{discount_percent}}%OFF！</strong>',
          'クイズの結果に基づいたあなただけの洞察で、ご自身の認知的な強みをより深く知ることができます。',
          '<strong>次のステップが、これまで以上に手軽でお得になりました。</strong>'
        ],
        cta: 'ノウミライレポートを受け取る — {{discount_percent}}%OFF',
        closing: 'これが最もお得なご案内です。クイズをもっと活かせるこの機会を、お見逃しなく。'
      },
      en: {
        subject: 'Your exclusive offer: {{discount_percent}}% off your NOUMIRAI Report!',
        preview: 'For a limited time, enjoy {{discount_percent}}% OFF your personalized NOUMIRAI Report.',
        paragraphs: [
          'You’ve completed your IQ quiz, and your personalized results are still waiting for you.',
          'For a limited time, enjoy <strong>{{discount_percent}}% OFF your personalized NOUMIRAI Report!</strong>',
          'Unlock personalized insights based on your quiz results and discover more about your cognitive strengths.',
          '<strong>Your next step is easier and more affordable than ever.</strong>'
        ],
        cta: 'Unlock NOUMIRAI Report — Save {{discount_percent}}%',
        closing: 'This is our best offer — don’t miss your chance to get more from your quiz.'
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

/**
 * Sets the copy's bold phrases in ink rather than the body's grey, as the
 * transactional designs do, and classes them so dark mode keeps the contrast.
 */
function emphasise(html: string): string {
  return html.replace(/<strong>/g, '<strong class="e-ink" style="color:' + INK + ';">');
}

/** Turns one definition into a registry entry. */
function buildTemplate(definition: ReminderDefinition): EmailTemplate {
  const { id, name, description, offer, copy, withDiscount } = definition;

  // Declared, not inferred: the admin panel lists these, and a template hosted
  // in ZeptoMail receives exactly these keys as merge_info.
  //
  // No `iq_score` and no `discount_code`, on purpose. The score is only
  // revealed once the report is paid for, so a reminder that prints it gives
  // away the thing it is selling. The code is never shown because it does not
  // need to be: cta_url carries it as `price_dis`, and checkout applies it.
  //
  // `discount_percent` only where the email can print it. On an offer design
  // its presence is what makes the settings save demand a code for the step;
  // on one with a `withDiscount` version, `subjectWithoutDiscount` below tells
  // the save it may go out on "No discount" as well.
  const params: EmailTemplateParam[] = [
    'first_name',
    'honorific_name',
    ...(offer || withDiscount ? (['discount_percent'] as const) : []),
    'cta_url',
    'site_url',
    'email',
    // Every design in this file is marketing, so every one of them carries an
    // opt-out. Declared here as well as used below, because a ZeptoMail-hosted
    // copy of this template receives only what is declared — and an email that
    // reaches the inbox without its unsubscribe link is the failure mode this
    // list exists to prevent.
    'unsubscribe_url'
  ];

  return {
    id,
    name,
    description,
    category: 'marketing',
    params,
    subject: withDiscount
      ? { ja: withDiscount.ja.subject, en: withDiscount.en.subject }
      : { ja: copy.ja.subject, en: copy.en.subject },
    subjectWithoutDiscount: withDiscount ? { ja: copy.ja.subject, en: copy.en.subject } : undefined,
    render(ctx: EmailTemplateContext): string {
      const source = copy[ctx.language] ?? copy.ja;

      // Null unless this send takes the discount version. A code the list
      // does not know resolves to no percent, and so to the letter as written
      // rather than a box with the number missing.
      const percent = withDiscount ? ctx.discount_percent : null;
      const inbox =
        withDiscount && percent !== null ? (withDiscount[ctx.language] ?? withDiscount.ja) : source;

      // Two interpolation passes, because the copy lands in two kinds of slot.
      // Paragraphs and the closing line carry inline markup and so are
      // injected as HTML — anything substituted into them must already be
      // escaped. The button label and preview are escaped by the layout, so
      // those take the raw values; escaping twice would show a customer
      // `O&#39;Brien`.
      const escaped = escapeContext(ctx);
      const asHtml = (text: string) => emphasise(interpolate(text, escaped));
      const asText = (text: string) => interpolate(text, ctx);

      const box = DISCOUNT_BOX[ctx.language] ?? DISCOUNT_BOX.ja;
      const cta =
        percent === null
          ? button(ctx.language, asText(source.cta), ctx.cta_url)
          : offerCard(ctx.language, {
              label: box.label,
              percent,
              subline: box.subline,
              cta: { label: asText(box.cta), url: ctx.cta_url },
              note: box.note
            });

      // The button sits inside the letter rather than in the layout's action
      // row, so the closing line can follow it as body text.
      const action =
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' +
        '<tr><td align="center" style="padding:14px 0 28px 0;">' +
        cta +
        '</td></tr></table>';

      const body =
        paragraph(greeting(ctx.language, ctx.first_name)) +
        source.paragraphs.map((p) => paragraph(asHtml(p), { html: true })).join('') +
        action +
        paragraph(asHtml(source.closing), { html: true });

      return renderLayout({
        language: ctx.language,
        title: asText(inbox.subject),
        previewText: asText(inbox.preview),
        body,
        recipientEmail: ctx.email,
        unsubscribeUrl: ctx.unsubscribe_url ?? undefined,
        siteUrl: ctx.site_url
      });
    }
  };
}

export const marketingReminderTemplates: EmailTemplate[] = DEFINITIONS.map(buildTemplate);
