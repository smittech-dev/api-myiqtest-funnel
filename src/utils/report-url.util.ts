import { config } from '../config/env.config.js';
import { EncryptionUtil } from './encryption.util.js';
import type { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';

/**
 * Where a customer's purchased documents live.
 *
 * Shared by the emails that deliver them and the members' area that lists them.
 * One implementation on purpose: a link that works in the welcome email and
 * 404s on the dashboard is the kind of difference nobody notices until a
 * customer reports it.
 */

export type ReportKind = 'first_sale' | 'cross_sale';

/** The funnel origin. Normalised once, in the config. */
const siteUrl = (): string => config.funnelUrl;

/**
 * Prefers a stored file over the live page.
 *
 * `customer_quiz_results.report_urls` exists for generated PDFs. Reading it
 * first means the day PDF generation is switched on, every link in the product
 * starts pointing at the file with no change here.
 *
 * The fallback is the funnel page that renders the report live, with the
 * encrypted quiz id on the query string — those pages are session-guarded, and
 * a link opened days later in a different browser has no session to restore
 * from.
 */
export function reportUrlFor(quizResult: CustomerQuizResult, kind: ReportKind): string {
  const stored = quizResult.report_urls ?? {};

  const storedUrl =
    kind === 'first_sale'
      ? (stored.report_pdf_url ?? stored.certificate_url)
      : stored.career_report_url;

  if (typeof storedUrl === 'string' && storedUrl.trim()) {
    return storedUrl.trim();
  }

  const language = quizResult.language?.toLowerCase() === 'en' ? 'en' : 'ja';
  // `/result` carries the certificate and the detailed report; `/result/report`
  // is the career and aptitude document the cross-sale unlocks.
  const path = kind === 'first_sale' ? 'result' : 'result/report';

  const url = new URL(`${siteUrl()}/${language}/${path}`);
  url.searchParams.set('quiz_id', EncryptionUtil.encryptId(quizResult.id));

  return url.toString();
}
