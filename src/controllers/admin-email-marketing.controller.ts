import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import {
  emailMarketingSettingsService,
  getEmailMarketingOptions
} from '../services/email-marketing-settings.service.js';
import { config } from '../config/env.config.js';
import { runEmailMarketing } from '../jobs/email-marketing.job.js';
import { emailMarketingService } from '../services/email-marketing.service.js';
import { emailService } from '../services/email.service.js';
import { providerTemplateKey } from '../emails/registry.js';
import { ResponseUtil } from '../utils/api-response.util.js';
import { parseDateRange } from '../utils/date-range.util.js';
import type { AdminEmailTransportStatus } from '../types/admin.types.js';

/**
 * The admin panel's view of the marketing sequence: read the settings, save
 * them, watch what went out, and force a run.
 *
 * The GET returns the settings *and* the catalogues its dropdowns are built
 * from — templates and discount codes — in one response. The panel therefore
 * cannot offer a choice the PUT would reject, and stays correct when a template
 * is added in a later deploy without the panel changing at all.
 */
export class AdminEmailMarketingController {
  /** GET /admin/email-marketing/config */
  static async getConfig(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const settings = await emailMarketingSettingsService.getConfig();
      const options = getEmailMarketingOptions();

      const transport: AdminEmailTransportStatus = {
        enabled: config.email.enabled,
        configured: emailService.isConfigured(),
        problem: emailService.configurationProblem(),
        from_address: config.email.fromAddress,
        from_name: config.email.fromName,
        dry_run: config.email.dryRun,
        cron_enabled: config.emailMarketing.cronEnabled,
        cron_expression: config.emailMarketing.cron,
        cron_timezone: config.emailMarketing.timezone
      };

      ResponseUtil.success(res, {
        settings,
        // Flagging which designs ZeptoMail renders, so an operator editing copy
        // in this repo knows when their change will have no effect.
        templates: options.templates.map((template) => ({
          ...template,
          hosted_in_zeptomail: providerTemplateKey(template.id) !== null
        })),
        discount_codes: options.discount_codes,
        transport,
        stats: await emailMarketingService.getStats()
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /admin/email-marketing/config
   *
   * The body is validated by the settings service's own schema rather than by
   * a route-level one, so every path into the tables — the panel, a script, a
   * direct API call — is held to exactly the same rules, including that a
   * template id exists and an enabled step's discount code is real.
   */
  static async saveConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const saved = await emailMarketingSettingsService.saveConfig(req.body);
      ResponseUtil.success(res, { settings: saved }, 'Email marketing settings saved');
    } catch (error) {
      if (error instanceof ZodError) {
        ResponseUtil.error(
          res,
          'Validation failed',
          400,
          error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }))
        );
        return;
      }
      next(error);
    }
  }

  /** GET /admin/email-marketing/logs */
  static async listLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as any;
      const { from, to } = parseDateRange(query.from, query.to);

      const result = await emailMarketingService.listLogs({
        page: query.page,
        page_size: query.page_size,
        step_key: query.step_key,
        status: query.status,
        search: query.search,
        from,
        to
      });

      ResponseUtil.success(res, result);
    } catch (error) {
      next(error);
    }
  }

  /** GET /admin/email-marketing/stats */
  static async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.query as any;
      const { from, to } = parseDateRange(query.from, query.to);
      ResponseUtil.success(res, await emailMarketingService.getStats({ from, to }));
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /admin/email-marketing/run
   *
   * Runs exactly what the five-minute cron runs — the same function, sharing
   * the same overlap guard. Unlike the cron it ignores EMAIL_MARKETING_ENABLED,
   * which governs the schedule: an operator asking for a run has asked for a
   * run. The sequence's own `enabled` flag is still respected, because that one
   * means "do not send to customers".
   */
  static async run(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const outcome = await runEmailMarketing('manual');

      if (outcome.status === 'skipped') {
        ResponseUtil.error(res, outcome.reason, 409);
        return;
      }

      if (outcome.status === 'failed') {
        ResponseUtil.error(res, outcome.reason, outcome.statusCode);
        return;
      }

      ResponseUtil.success(res, outcome.result, 'Email marketing run completed');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /admin/email-marketing/test-send
   *
   * Sends one design to a chosen address with sample data. Writes no tracking
   * row: a test must not consume anyone's place in the sequence.
   */
  static async testSend(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { template_id, to, language, discount_code } = req.body;

      const result = await emailMarketingService.sendTest({
        templateId: template_id,
        to,
        language,
        discountCode: discount_code ?? null
      });

      ResponseUtil.success(res, result, `Test email sent to ${to}`);
    } catch (error) {
      next(error);
    }
  }
}
