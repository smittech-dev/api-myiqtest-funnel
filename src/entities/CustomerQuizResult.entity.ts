import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index
} from 'typeorm';
import type { Customer } from './Customer.entity.js';
import type { CustomerQuizResultPaymentTransaction } from './CustomerQuizResultPaymentTransaction.entity.js';
import type { CustomerSubscription } from './CustomerSubscription.entity.js';

@Entity('customer_quiz_results')
export class CustomerQuizResult {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint', nullable: true })
  @Index('idx_customer_quiz_results_customer_id')
  customer_id!: string | null;

  @ManyToOne('Customer', 'quiz_results', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer | null;

  @Column({ type: 'varchar', length: 255 })
  @Index('idx_customer_quiz_results_email')
  email!: string;

  // Card saved by the first sale, reused for the cross-sale and the subscription.
  // Stored here (rather than re-read from Stripe every time) so later charges do
  // not depend on a round trip to the payment provider.
  @Column({ type: 'varchar', length: 255, nullable: true })
  stripe_payment_method_id!: string | null;

  /**
   * The address an Apple Pay or Google Pay sheet handed over, held back.
   *
   * A wallet payment leaves the customer on their placeholder address
   * (`dummy_{id}@noumirai.com`), and this is the real one waiting to replace
   * it. It is a fallback, not the answer: an address typed on the Personal
   * Detail page wins, and clears this. Only if nothing is typed does the
   * replacement job apply it, `pending_email_due_at` after the payment — the
   * delay is the window in which the customer can give us an address they
   * would rather use than, say, an Apple "Hide My Email" relay.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  pending_email!: string | null;

  /**
   * When the job may apply `pending_email`. Set when the first sale succeeds,
   * ten minutes out; null otherwise. Indexed because the job asks for exactly
   * the rows whose time has come, every minute.
   */
  @Column({ type: 'timestamptz', nullable: true })
  @Index('idx_customer_quiz_results_pending_email_due_at')
  pending_email_due_at!: Date | null;

  /**
   * When the customer turned the upsell down.
   *
   * The backend used to have no notion of "declined", because it did not need
   * one: the details page came after the upsell, and saving details ended the
   * funnel whatever had happened there. With details now *before* the upsell,
   * saving them can no longer mean the upsell is settled, and without this a
   * customer who declined would be sent back to it every time they opened the
   * result page — from the report email, a new tab, another device.
   */
  @Column({ type: 'timestamptz', nullable: true })
  cross_sell_declined_at!: Date | null;

  /**
   * Which funnel this attempt went through. 2 = the email arrives with the
   * payment and Personal Detail comes before the upsell; null = everything
   * submitted before that change.
   *
   * Recorded rather than inferred from a date because both funnels are live at
   * once for a while: a visitor whose browser still holds the previous bundle
   * submits with an email and walks the old page order, and must be routed by
   * the old rules or they loop between pages. Null also keeps every historical
   * result where it was — a customer who skipped the upsell months ago and
   * opens their report link today still lands on the report, not the upsell.
   */
  @Column({ type: 'smallint', nullable: true })
  funnel_version!: number | null;

  // Demographics
  @Column({ type: 'varchar', length: 150, nullable: true })
  first_name!: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  last_name!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  age!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  gender!: string | null;

  // Score & Performance
  @Column({ type: 'integer', nullable: true })
  iq_score!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  category_scores!: Record<string, number> | null;

  @Column({ type: 'integer', nullable: true })
  duration_seconds!: number | null;

  // Funnel & Marketing Attribution
  @Column({ type: 'varchar', length: 10, default: 'ja' })
  language!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  ip_address!: string | null;

  @Column({ type: 'varchar', length: 2, default: 'JP' })
  country_code!: string;

  @Column({ type: 'jsonb', nullable: true })
  landing_url_details!: Record<string, any> | null;

  // Generated Assets
  @Column({ type: 'jsonb', nullable: true })
  report_urls!: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  @Index('idx_customer_quiz_results_created_at')
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updated_at!: Date;

  @OneToMany('CustomerQuizResultPaymentTransaction', 'quiz_result')
  transactions!: CustomerQuizResultPaymentTransaction[];

  @OneToMany('CustomerSubscription', 'quiz_result')
  subscriptions!: CustomerSubscription[];
}
