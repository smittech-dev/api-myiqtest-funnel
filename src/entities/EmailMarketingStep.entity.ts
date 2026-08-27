import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index
} from 'typeorm';

/**
 * One rung of the discount ladder: how long after the quiz it fires, which
 * discount code it carries, and which design from the template master it uses.
 *
 * `step_key` is the important column. It is what `email_marketing_logs.step_key`
 * records, and therefore what the "has this customer already had this step?"
 * guarantee is keyed on. There is deliberately **no foreign key** between the
 * two tables: deleting a retired step must not erase the history of the emails
 * it sent, and must not be blocked by that history either. The key is a stable
 * string both tables agree on, nothing more.
 *
 * Which means: renaming a step's key orphans its history and the sequence will
 * send that rung again to everyone. The admin panel treats the key as read-only
 * once a step exists, and the label carries anything an operator wants to
 * reword.
 */
@Entity('email_marketing_steps')
export class EmailMarketingStep {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  /** Permanent identity, referenced by every log row this step ever wrote. */
  @Column({ type: 'varchar', length: 50, unique: true })
  @Index('idx_email_marketing_steps_step_key')
  step_key!: string;

  /** Display only — safe to reword at any time. */
  @Column({ type: 'varchar', length: 120 })
  label!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  /**
   * Hours after quiz submission. Fractional values are allowed so the whole
   * ladder can be exercised in minutes rather than days when testing.
   */
  @Column({ type: 'double precision' })
  delay_hours!: number;

  /** A code from data/discount-codes.json. Null means "send without a discount". */
  @Column({ type: 'varchar', length: 50, nullable: true })
  discount_code!: string | null;

  /** A template id from the master registry in src/emails/registry.ts. */
  @Column({ type: 'varchar', length: 100 })
  template_id!: string;

  /**
   * Display order in the admin table.
   *
   * Only cosmetic: the runner orders the ladder by `delay_hours`, because that
   * is what actually decides which rung comes first. Two steps whose sort order
   * disagrees with their delays would still fire in delay order.
   */
  @Column({ type: 'int', default: 0 })
  sort_order!: number;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updated_at!: Date;
}
