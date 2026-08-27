import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn
} from 'typeorm';

/**
 * The marketing sequence's global settings — a deliberate singleton, always
 * `id = 1`.
 *
 * A fixed primary key rather than a generated one because there is exactly one
 * of these: it makes the seed an `INSERT ... ON CONFLICT DO NOTHING` that two
 * instances booting at once cannot duplicate, and it makes "the settings row"
 * something you can address directly rather than having to order by id and
 * hope.
 *
 * The per-step ladder lives in `email_marketing_steps`, one row per rung.
 */
@Entity('email_marketing_settings')
export class EmailMarketingSetting {
  /** Always 1. See the class comment. */
  @PrimaryColumn({ type: 'int' })
  id!: number;

  /**
   * The sequence's own switch, and the admin's to flip.
   *
   * Separate from EMAIL_MARKETING_ENABLED, which decides whether the cron is
   * registered at all: this one pauses sending while leaving the schedule in
   * place, which is what "stop the emails, now" needs to mean from a panel.
   */
  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  /** Emails per run. Caps the blast radius of a misconfiguration. */
  @Column({ type: 'int', default: 50 })
  batch_size!: number;

  /** Provider calls per step before it is abandoned as failed. */
  @Column({ type: 'int', default: 3 })
  max_attempts!: number;

  /**
   * Quizzes older than this are never contacted — the guard that stops enabling
   * the feature from emailing every unconverted lead in the table's history.
   *
   * `double precision` so a fractional value is possible; the app treats hours
   * as a real number throughout so the ladder can be tested in minutes.
   */
  @Column({ type: 'double precision', default: 240 })
  max_age_hours!: number;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updated_at!: Date;
}
