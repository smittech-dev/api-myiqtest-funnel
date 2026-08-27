import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from 'typeorm';

/**
 * The delivery record for the two emails a paying customer receives — the
 * welcome with their programme credentials, and the report-ready notice.
 *
 * **Why this is not `email_marketing_logs`.** The two tables look similar and
 * dedupe on different things, which is exactly why they are separate. A
 * marketing step is once per *person*: someone who took the quiz three times is
 * still one person and gets the 24-hour nudge once. A transactional email is
 * once per *purchase*: a customer who comes back, takes the quiz again and buys
 * again has genuinely bought a second report, and must be sent it. Forcing both
 * into one unique constraint would mean picking one of those rules and getting
 * the other wrong.
 *
 * `dedup_key` carries that scope explicitly — `welcome:1042`,
 * `report_ready:1042`, where the number is the quiz result. It is UNIQUE, and
 * the sender claims it by inserting this row **before** calling the provider,
 * so the Stripe webhook and the confirm endpoint racing on the same payment
 * produce one email and one no-op rather than two welcomes.
 */
@Entity('email_transactional_logs')
export class EmailTransactionalLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  /**
   * What this send is, scoped to the thing it is about. Unique — this column is
   * the whole of the "have we already sent it?" guarantee.
   */
  @Column({ type: 'varchar', length: 120, unique: true })
  @Index('idx_email_transactional_logs_dedup_key')
  dedup_key!: string;

  @Column({ type: 'bigint', nullable: true })
  @Index('idx_email_transactional_logs_customer_id')
  customer_id!: string | null;

  @Column({ type: 'bigint', nullable: true })
  customer_quiz_result_id!: string | null;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  /** A template id from the master registry in src/emails/registry.ts. */
  @Column({ type: 'varchar', length: 100 })
  template_id!: string;

  @Column({ type: 'varchar', length: 10, default: 'ja' })
  language!: string;

  /** pending (claimed, provider call in flight) | sent | failed */
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  @Index('idx_email_transactional_logs_status')
  status!: 'pending' | 'sent' | 'failed';

  /** ZeptoMail's request_id, for tracing one delivery in their console. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  provider_message_id!: string | null;

  @Column({ type: 'text', nullable: true })
  error_message!: string | null;

  /** Provider calls made. Bounded by TRANSACTIONAL_EMAIL_MAX_ATTEMPTS. */
  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ type: 'timestamptz', nullable: true })
  sent_at!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  @Index('idx_email_transactional_logs_created_at')
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updated_at!: Date;
}
