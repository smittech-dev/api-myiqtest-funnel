import { z } from 'zod';
import { AppDataSource } from '../config/database.config.js';
import { discountCodes } from '../config/discount-codes.config.js';
import { EmailMarketingSetting } from '../entities/EmailMarketingSetting.entity.js';
// Aliased: the entity is the persisted row, `EmailMarketingStep` below is the
// validated shape the rest of the application passes around. Same concept, two
// representations, and this is the one file that has to hold both.
import { EmailMarketingStep as EmailMarketingStepRow } from '../entities/EmailMarketingStep.entity.js';
import { getTemplate, listTemplates, templateExists } from '../emails/registry.js';
import { logger } from '../utils/logger.util.js';

/**
 * The marketing sequence's operational settings, stored in the database.
 *
 * Two tables: `email_marketing_settings` holds the single row of global
 * options, `email_marketing_steps` holds one row per rung of the ladder. Both
 * are edited from the admin panel and read fresh by every run.
 *
 * **Nothing is cached.** A settings read is two small indexed queries against
 * tables with single-digit row counts, and it happens once per five-minute
 * cron tick and once per admin page load. Caching it would buy nothing
 * measurable and would cost correctness the moment the app runs on more than
 * one instance: an operator pausing the sequence on the instance behind the
 * load balancer would not pause the one running the cron.
 */

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** A step key is referenced by every log row it ever wrote — treat it as permanent. */
const stepKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[a-z0-9_]+$/, 'Step key may contain lowercase letters, digits and underscores only');

export const emailMarketingStepSchema = z.object({
  key: stepKeySchema,
  /** Shown in the admin table and nowhere else — safe to reword at any time. */
  label: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  /**
   * Hours after quiz submission. Fractional values are allowed so the sequence
   * can be tested end-to-end in minutes rather than days (0.05 = 3 minutes).
   */
  delay_hours: z.number().min(0.01).max(24 * 365),
  /** A code from data/discount-codes.json. Empty means "send without a discount". */
  discount_code: z.string().trim().max(50),
  /** A template id from the template master. */
  template_id: z.string().trim().min(1).max(100)
});

export const emailMarketingConfigSchema = z
  .object({
    enabled: z.boolean(),
    batch_size: z.number().int().min(1).max(500),
    max_attempts: z.number().int().min(1).max(10),
    max_age_hours: z.number().min(1).max(24 * 365),
    steps: z.array(emailMarketingStepSchema).min(1).max(20)
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();

    value.steps.forEach((step, index) => {
      if (seen.has(step.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', index, 'key'],
          message: `Duplicate step key "${step.key}" — keys identify sent history and must be unique.`
        });
      }
      seen.add(step.key);

      if (!templateExists(step.template_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', index, 'template_id'],
          message: `Unknown template "${step.template_id}".`
        });
      }

      // Only enforced for a step that can actually send: a disabled draft is
      // allowed to reference a code that has not been created yet.
      if (step.enabled && step.discount_code && !discountCodes[step.discount_code.toUpperCase()]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', index, 'discount_code'],
          message: `Discount code "${step.discount_code}" is not in data/discount-codes.json.`
        });
      }

      // A design that writes the discount into its copy cannot be sent without
      // one — the customer would receive "%OFF" and an offer with no code.
      // Tied to the template's declared parameters rather than made a blanket
      // rule, so a plain reminder template can still be scheduled with no
      // discount attached.
      const template = getTemplate(step.template_id);
      const needsDiscount = template?.params.includes('discount_percent') ?? false;

      if (step.enabled && needsDiscount && !step.discount_code) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', index, 'discount_code'],
          message: `The "${template?.name ?? step.template_id}" template writes the discount into its copy — pick a code, or choose a template that does not need one.`
        });
      }
    });

    const delays = value.steps.filter((s) => s.enabled).map((s) => s.delay_hours);

    if (new Set(delays).size !== delays.length) {
      // Two enabled rungs at the same hour is ambiguous: both become due in the
      // same tick and only one can be sent, so the other would be silently
      // skipped forever. Better to refuse the save.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['steps'],
        message: 'Two enabled steps share the same delay — give each a distinct number of hours.'
      });
    }
  });

export type EmailMarketingStep = z.infer<typeof emailMarketingStepSchema>;
export type EmailMarketingConfig = z.infer<typeof emailMarketingConfigSchema>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** The singleton settings row always has this id. */
const SETTINGS_ID = 1;

/**
 * The sequence from the brief: 24h and 48h at 20% off, then 72h and 5 days at
 * 50%. Seeded into the database the first time the app runs against an empty
 * `email_marketing_settings` table, with the sequence **disabled** — so a fresh
 * environment boots with a working ladder that sends nothing until someone
 * turns it on.
 */
export const DEFAULT_EMAIL_MARKETING_CONFIG: EmailMarketingConfig = {
  enabled: false,
  batch_size: 50,
  max_attempts: 3,
  max_age_hours: 240, // 10 days — the last step plus a few days of slack
  steps: [
    {
      key: 'step_24h',
      label: '24 hours — 20% off',
      enabled: true,
      delay_hours: 24,
      discount_code: 'K75QSQC',
      template_id: 'marketing_reminder_day1'
    },
    {
      key: 'step_48h',
      label: '48 hours — 20% off',
      enabled: true,
      delay_hours: 48,
      discount_code: 'K75QSQC',
      template_id: 'marketing_reminder_day2'
    },
    {
      key: 'step_72h',
      label: '72 hours — 50% off',
      enabled: true,
      delay_hours: 72,
      discount_code: '5G4A2TC',
      template_id: 'marketing_reminder_day3'
    },
    {
      key: 'step_5d',
      label: '5 days — 50% off',
      enabled: true,
      delay_hours: 120,
      discount_code: '5G4A2TC',
      template_id: 'marketing_reminder_day5'
    }
  ]
};

// ---------------------------------------------------------------------------
// Reads and writes
// ---------------------------------------------------------------------------

export class EmailMarketingSettingsService {
  private settingsRepository = AppDataSource.getRepository(EmailMarketingSetting);
  private stepRepository = AppDataSource.getRepository(EmailMarketingStepRow);

  /**
   * Writes the defaults if the settings table is empty. Called before every
   * read, so a fresh database needs no separate seeding step.
   *
   * Both inserts use `ON CONFLICT DO NOTHING`, which is what makes this safe
   * when two instances boot at the same moment: the second one's insert is
   * discarded by the database rather than raising a duplicate-key error that
   * would take the process down.
   */
  private async ensureSeeded(): Promise<void> {
    const existing = await this.settingsRepository.count();
    if (existing > 0) return;

    const defaults = DEFAULT_EMAIL_MARKETING_CONFIG;

    await this.settingsRepository
      .createQueryBuilder()
      .insert()
      .values({
        id: SETTINGS_ID,
        enabled: defaults.enabled,
        batch_size: defaults.batch_size,
        max_attempts: defaults.max_attempts,
        max_age_hours: defaults.max_age_hours
      })
      .orIgnore()
      .execute();

    await this.stepRepository
      .createQueryBuilder()
      .insert()
      .values(
        defaults.steps.map((step, index) => ({
          step_key: step.key,
          label: step.label,
          enabled: step.enabled,
          delay_hours: step.delay_hours,
          discount_code: step.discount_code || null,
          template_id: step.template_id,
          sort_order: index
        }))
      )
      .orIgnore()
      .execute();

    logger.info('Seeded the default email marketing sequence (disabled until switched on).');
  }

  /** The current settings, read fresh from the database. */
  async getConfig(): Promise<EmailMarketingConfig> {
    await this.ensureSeeded();

    const [settings, steps] = await Promise.all([
      this.settingsRepository.findOne({ where: { id: SETTINGS_ID } }),
      this.stepRepository.find({ order: { sort_order: 'ASC', id: 'ASC' } })
    ]);

    // Only reachable if someone deleted the row by hand between the seed and
    // this read. Falling back keeps the app answering rather than 500-ing, and
    // the next call re-seeds.
    if (!settings) {
      logger.warn('No email marketing settings row found — answering with the defaults.');
      return DEFAULT_EMAIL_MARKETING_CONFIG;
    }

    return {
      enabled: settings.enabled,
      batch_size: settings.batch_size,
      max_attempts: settings.max_attempts,
      // `double precision` comes back as a number, but a column altered to
      // numeric by hand would arrive as a string — coerce so a mistyped
      // migration cannot turn every delay comparison into string arithmetic.
      max_age_hours: Number(settings.max_age_hours),
      steps: steps.map((step) => ({
        key: step.step_key,
        label: step.label,
        enabled: step.enabled,
        delay_hours: Number(step.delay_hours),
        discount_code: step.discount_code ?? '',
        template_id: step.template_id
      }))
    };
  }

  /**
   * Validates and persists a complete settings object.
   *
   * Replaces the ladder wholesale rather than patching it: a step's delay only
   * means something against the other steps' delays, so the schema has to see
   * all of them at once to catch two rungs sharing an hour.
   *
   * Runs in a transaction, so a save that fails halfway cannot leave the
   * sequence with three of four steps updated — which, with a discount ladder,
   * would mean sending the wrong offer.
   *
   * Throws a ZodError when the shape is wrong; the controller turns that into a
   * 400 naming the offending field.
   */
  async saveConfig(input: unknown): Promise<EmailMarketingConfig> {
    const next = emailMarketingConfigSchema.parse(input);

    await AppDataSource.transaction(async (manager) => {
      await manager
        .createQueryBuilder()
        .insert()
        .into(EmailMarketingSetting)
        .values({
          id: SETTINGS_ID,
          enabled: next.enabled,
          batch_size: next.batch_size,
          max_attempts: next.max_attempts,
          max_age_hours: next.max_age_hours
        })
        .orUpdate(['enabled', 'batch_size', 'max_attempts', 'max_age_hours'], ['id'])
        .execute();

      const keptKeys = next.steps.map((step) => step.key);

      // Steps the operator removed. Their log rows are deliberately left
      // behind: the history of what was sent is not the operator's to delete,
      // and nothing references this table by foreign key.
      const removed = await manager
        .createQueryBuilder()
        .delete()
        .from(EmailMarketingStepRow)
        .where('step_key NOT IN (:...keptKeys)', { keptKeys })
        .execute();

      if (removed.affected) {
        logger.info(`Removed ${removed.affected} email marketing step(s) no longer configured.`);
      }

      await manager
        .createQueryBuilder()
        .insert()
        .into(EmailMarketingStepRow)
        .values(
          next.steps.map((step, index) => ({
            step_key: step.key,
            label: step.label,
            enabled: step.enabled,
            delay_hours: step.delay_hours,
            discount_code: step.discount_code || null,
            template_id: step.template_id,
            sort_order: index
          }))
        )
        // Upsert on the key, so an existing step keeps its id (and therefore
        // its creation date) while a new one is inserted.
        .orUpdate(
          ['label', 'enabled', 'delay_hours', 'discount_code', 'template_id', 'sort_order'],
          ['step_key']
        )
        .execute();
    });

    logger.info(
      `Email marketing settings saved: ${next.enabled ? 'enabled' : 'disabled'}, ` +
        `${next.steps.filter((s) => s.enabled).length}/${next.steps.length} step(s) active.`
    );

    return this.getConfig();
  }
}

export const emailMarketingSettingsService = new EmailMarketingSettingsService();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Enabled steps, soonest first — the order the runner walks the ladder in.
 *
 * Ordered by delay rather than by the table's `sort_order`, because the delay
 * is what actually decides which rung comes first. A display order that
 * disagrees with the delays is a cosmetic problem, not a sending one.
 */
export function enabledStepsInOrder(cfg: EmailMarketingConfig): EmailMarketingStep[] {
  return cfg.steps.filter((s) => s.enabled).sort((a, b) => a.delay_hours - b.delay_hours);
}

/**
 * The two catalogues the admin editor's dropdowns are built from. Served
 * alongside the settings so the panel can never offer a template or code the
 * save would then reject.
 *
 * Sends **every** template, marketing and transactional, each tagged with its
 * category. The panel filters: the step picker offers marketing designs only,
 * while the test-send box offers all of them — an operator needs to preview the
 * welcome email as much as a discount nudge, and there is no second endpoint
 * that would let them.
 */
export function getEmailMarketingOptions() {
  return {
    templates: listTemplates().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      params: [...t.params],
      subject: t.subject
    })),
    discount_codes: Object.values(discountCodes)
      .map((entry) => ({ code: entry.code, discount: entry.discount }))
      .sort((a, b) => a.discount - b.discount)
  };
}
