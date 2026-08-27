import { config } from '../config/env.config.js';
import type { EmailTemplateContext } from '../emails/email.types.js';
import {
  getTemplate,
  mergeInfoFor,
  providerTemplateKey,
  renderTemplate
} from '../emails/registry.js';
import { externalApiLogService } from './external-api-log.service.js';
import { logger } from '../utils/logger.util.js';

/**
 * The one way mail leaves this application: ZeptoMail's REST API, addressed by
 * a template id from the master registry.
 *
 * Callers never see HTML, headers or the provider's payload shape. They name a
 * template and hand over a context; this decides whether the design renders
 * here or inside ZeptoMail, builds the right request for that choice, and
 * reports back as data.
 *
 * Nothing here throws. A marketing run must not die because a provider returned
 * a 500 on one address, and the caller needs the reason to write into the send
 * log either way — so every failure comes back as `{ status: 'failed', error }`.
 */

/** ZeptoMail's response envelope, the parts we read. */
interface ZeptoMailResponse {
  request_id?: string;
  message?: string;
  data?: Array<{ code?: string; message?: string; additional_info?: unknown }>;
  error?: {
    code?: string;
    message?: string;
    /** The specific reason. `message` alone is a category like "Access Denied". */
    details?: Array<{ code?: string; message?: string; target?: string }>;
  };
}

/**
 * The most specific thing ZeptoMail said.
 *
 * Their envelope carries a category in `error.message` and the actual cause in
 * `error.details[0]`, so reading only the former turns "Invalid API Token
 * found" into a bare "Access Denied" — the difference between a fixable report
 * and a shrug. Both are kept, with their codes, because the code is what their
 * documentation is indexed by.
 */
function describeZeptoError(body: ZeptoMailResponse | null, statusCode: number | null): string {
  const error = body?.error;

  if (!error) {
    return body?.data?.[0]?.message ?? body?.message ?? `Provider returned HTTP ${statusCode}`;
  }

  const detail = error.details?.[0];
  const parts = [error.message ?? `HTTP ${statusCode}`];

  if (detail?.message && detail.message !== error.message) {
    parts.push(detail.message);
  }

  const codes = [error.code, detail?.code].filter(Boolean).join('/');
  const text = parts.join(': ');

  return codes ? `${text} (${codes})` : text;
}

export interface SendEmailInput {
  templateId: string;
  to: string;
  /** Recipient display name, when known. */
  toName?: string | null;
  context: EmailTemplateContext;
}

export type EmailSendResult =
  | { status: 'sent'; messageId: string | null; subject: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string; statusCode: number | null };

/** ZeptoMail's template endpoint sits alongside the plain one. */
function templateEndpoint(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '') + '/template';
}

export class EmailService {
  /**
   * True when the transport could actually deliver something. The admin panel
   * shows this so an operator can tell "the sequence is off" from "the mail
   * credentials were never filled in".
   */
  isConfigured(): boolean {
    return Boolean(config.email.token && config.email.fromAddress);
  }

  /** Why it is not configured, for the same panel. Null when it is. */
  configurationProblem(): string | null {
    if (!config.email.token) return 'ZEPTOMAIL_TOKEN is not set.';
    if (!config.email.fromAddress) return 'ZEPTOMAIL_FROM_ADDRESS is not set.';
    return null;
  }

  async send(input: SendEmailInput): Promise<EmailSendResult> {
    const { templateId, to, toName, context } = input;

    const template = getTemplate(templateId);
    if (!template) {
      return { status: 'failed', error: `Unknown email template "${templateId}"`, statusCode: null };
    }

    if (!config.email.enabled) {
      return { status: 'skipped', reason: 'Email sending is disabled (ZEPTOMAIL_ENABLED=false).' };
    }

    const problem = this.configurationProblem();
    if (problem) {
      logger.warn(`Email not sent to ${to}: ${problem}`);
      return { status: 'skipped', reason: problem };
    }

    // A hosted template key means ZeptoMail owns the design and we send only
    // the parameters; otherwise we render here and send the finished HTML.
    const hostedKey = providerTemplateKey(templateId);
    const url = hostedKey ? templateEndpoint(config.email.apiUrl) : config.email.apiUrl;

    const recipient = {
      email_address: {
        address: to,
        ...(toName ? { name: toName } : {})
      }
    };

    const common = {
      from: { address: config.email.fromAddress, name: config.email.fromName },
      to: [recipient],
      track_opens: config.email.trackOpens,
      track_clicks: config.email.trackClicks,
      // Lets support find one send in ZeptoMail's console from the template id
      // alone, without correlating on timestamps.
      client_reference: templateId,
      ...(config.email.replyTo
        ? { reply_to: [{ address: config.email.replyTo, name: config.email.fromName }] }
        : {})
    };

    let payload: Record<string, unknown>;
    let subject: string;

    if (hostedKey) {
      subject = template.subject[context.language] ?? template.subject.ja;
      payload = {
        ...common,
        template_key: hostedKey,
        merge_info: mergeInfoFor(templateId, context)
      };
    } else {
      let rendered;
      try {
        rendered = renderTemplate(templateId, context);
      } catch (err: any) {
        logger.error(`Rendering template "${templateId}" failed: ${err.message}`);
        return { status: 'failed', error: `Template render failed: ${err.message}`, statusCode: null };
      }
      subject = rendered.subject;
      payload = { ...common, subject: rendered.subject, htmlbody: rendered.html };
    }

    if (config.email.dryRun) {
      logger.info(
        `[EMAIL DRY RUN] template=${templateId} to=${to} subject="${subject}"` +
          (hostedKey ? ` (hosted template ${hostedKey})` : '')
      );
      return { status: 'sent', messageId: null, subject };
    }

    return this.post(url, payload, { templateId, to, subject });
  }

  /**
   * The HTTP call, plus the external_api_logs row that makes a delivery
   * problem diagnosable after the fact.
   */
  private async post(
    url: string,
    payload: Record<string, unknown>,
    meta: { templateId: string; to: string; subject: string }
  ): Promise<EmailSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.email.requestTimeoutMs);
    const startedAt = Date.now();

    let response: Response;
    let body: ZeptoMailResponse | null = null;
    let statusCode: number | null = null;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          // ZeptoMail prints the token already prefixed with the scheme, so the
          // env var carries the whole header value. Tolerate a bare token too.
          Authorization: config.email.token.startsWith('Zoho-enczapikey')
            ? config.email.token
            : `Zoho-enczapikey ${config.email.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      statusCode = response.status;

      try {
        body = (await response.json()) as ZeptoMailResponse;
      } catch {
        body = null;
      }
    } catch (err: any) {
      const reason = err?.name === 'AbortError' ? 'request timed out' : err?.message;
      const duration = Date.now() - startedAt;

      await externalApiLogService.log({
        service_name: 'zeptomail',
        endpoint: url,
        method: 'POST',
        request_payload: this.redact(payload),
        is_error: true,
        error_message: reason,
        duration_ms: duration
      });

      logger.error(`ZeptoMail unreachable for ${meta.to}: ${reason}`);
      return { status: 'failed', error: `Provider unreachable: ${reason}`, statusCode: null };
    } finally {
      clearTimeout(timer);
    }

    const duration = Date.now() - startedAt;
    const ok = response.ok;
    const providerMessage = ok ? null : describeZeptoError(body, statusCode);

    await externalApiLogService.log({
      service_name: 'zeptomail',
      endpoint: url,
      method: 'POST',
      status_code: statusCode ?? undefined,
      request_payload: this.redact(payload),
      response_payload: body ?? undefined,
      is_error: !ok,
      error_message: ok ? undefined : (providerMessage ?? `HTTP ${statusCode}`),
      duration_ms: duration
    });

    if (!ok) {
      const error = providerMessage ?? `Provider returned HTTP ${statusCode}`;

      // A 401 is almost always the token not matching the account's datacenter,
      // and the message alone does not say so. Naming the suspect here saves the
      // next person the round of guessing this cost once already.
      const hint =
        statusCode === 401
          ? ` — check ZEPTOMAIL_TOKEN, and that ZEPTOMAIL_API_URL (${config.email.apiUrl}) is your account's datacenter`
          : '';

      logger.error(`ZeptoMail rejected ${meta.templateId} for ${meta.to}: ${error}${hint}`);
      return { status: 'failed', error: error + hint, statusCode };
    }

    logger.info(
      `Email sent: template=${meta.templateId} to=${meta.to} request_id=${body?.request_id ?? 'n/a'} (${duration}ms)`
    );

    return { status: 'sent', messageId: body?.request_id ?? null, subject: meta.subject };
  }

  /**
   * Strips the rendered HTML before the payload is stored.
   *
   * external_api_logs keeps every request body, and a 40KB marketing email per
   * send would turn that table into the largest thing in the database within a
   * week. The headers are what a delivery investigation actually needs.
   */
  private redact(payload: Record<string, unknown>): Record<string, unknown> {
    const { htmlbody, ...rest } = payload;
    return htmlbody === undefined
      ? rest
      : { ...rest, htmlbody: `[${String(htmlbody).length} chars omitted]` };
  }
}

export const emailService = new EmailService();
