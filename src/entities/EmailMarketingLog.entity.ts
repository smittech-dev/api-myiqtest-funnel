import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique
} from 'typeorm';

/**
 * One row per (customer, sequence step) — the whole of the "did we already
 * nudge this person at this stage?" question.
 *
 * The unique constraint on `(customer_id, step_key)` is the guarantee the
 * sequence rests on: a customer can never receive the same step twice, no
 * matter how often the five-minute cron runs, how many quizzes they submitted,
 * or whether two workers tick at the same moment. The runner claims a step by
 * inserting this row with `ON CONFLICT DO NOTHING` **before** it calls the
 * email provider, so a duplicate is rejected by the database rather than by a
 * check that could race.
 *
 * Keyed on the customer rather than the quiz submission on purpose: someone who
 * takes the quiz three times is still one person, and should be nudged once.
 *
 * `status` is the row's life cycle:
 *   pending  — claimed by a runner, provider call in flight
 *   sent     — accepted by ZeptoMail
 *   failed   — the provider refused or was unreachable; retried until `attempts`
 *              reaches the configured maximum
 *   skipped  — deliberately never sent (see `skip_reason`), most often because a
 *              later step of the ladder became due first
 */
@Entity('email_marketing_logs')
@Unique('uq_email_marketing_logs_customer_step', ['customer_id', 'step_key'])
export class EmailMarketingLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  @Index('idx_email_marketing_logs_customer_id')
  customer_id!: string;

  // The submission the nudge was written about. Nullable because the customer,
  // not the quiz, is what this table is keyed on — deleting a quiz result must
  // not erase the record that a step was already spent.
  @Column({ type: 'bigint', nullable: true })
  customer_quiz_result_id!: string | null;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  // Which rung of the ladder — matches `email_marketing_steps.step_key`.
  // Deliberately not a foreign key: deleting a retired step must neither erase
  // the history of what it sent nor be blocked by it.
  @Column({ type: 'varchar', length: 50 })
  @Index('idx_email_marketing_logs_step_key')
  step_key!: string;

  // Which design was used, as an id from the template master. Recorded so a
  // later template rename cannot rewrite history.
  @Column({ type: 'varchar', length: 100 })
  template_id!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  discount_code!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'ja' })
  language!: string;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  @Index('idx_email_marketing_logs_status')
  status!: 'pending' | 'sent' | 'failed' | 'skipped';

  // ZeptoMail's request_id for the accepted message — the handle support needs
  // to trace one delivery in the provider's own console.
  @Column({ type: 'varchar', length: 255, nullable: true })
  provider_message_id!: string | null;

  @Column({ type: 'text', nullable: true })
  error_message!: string | null;

  // Why a step was retired without sending, e.g. "superseded by step_3".
  @Column({ type: 'varchar', length: 255, nullable: true })
  skip_reason!: string | null;

  // Provider calls made for this step. Bounded by max_attempts so a permanently
  // rejected address cannot be retried every five minutes forever.
  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ type: 'timestamptz', nullable: true })
  sent_at!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  @Index('idx_email_marketing_logs_created_at')
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updated_at!: Date;
}
