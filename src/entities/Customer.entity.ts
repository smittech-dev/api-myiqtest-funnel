import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany
} from 'typeorm';
import type { CustomerSubscription } from './CustomerSubscription.entity.js';
import type { CustomerQuizResult } from './CustomerQuizResult.entity.js';
import type { CustomerQuizResultPaymentTransaction } from './CustomerQuizResultPaymentTransaction.entity.js';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  password_hash!: string | null;

  /**
   * When a real, customer-usable password was issued — set by the welcome email
   * on the first sale, and null for everyone who has only taken the quiz.
   *
   * The distinction matters because the funnel seeds `password_hash` with a
   * throwaway sha256 value at quiz submission, so a non-null hash proves
   * nothing. This column is what stops a returning customer's second purchase
   * silently resetting the password they are already using: with it set, the
   * welcome email is sent without new credentials instead.
   */
  @Column({ type: 'timestamptz', nullable: true })
  password_set_at!: Date | null;

  // Result of the Reoon email verification run when the email was first captured.
  // Defaults to false: unverified until a check actually says otherwise.
  @Column({ type: 'boolean', default: false })
  email_verified!: boolean;

  @Column({ type: 'varchar', length: 50, default: 'inactive' })
  status!: string;

  /**
   * When they asked to stop receiving marketing email. NULL means they have not.
   *
   * A timestamp rather than a boolean so the answer to "when did I unsubscribe?"
   * is in the row rather than in a log, and so it reads like the other
   * one-way flags here (`password_set_at`) and on the subscription
   * (`canceled_at`).
   *
   * Only the abandoned-checkout sequence honours it. Receipts, password resets
   * and address-change confirmations are transactional and keep being sent —
   * see the split enforced by template `category` in email.service.ts.
   */
  @Column({ type: 'timestamptz', nullable: true })
  marketing_unsubscribed_at!: Date | null;

  /** How it happened — 'email_link', 'admin', 'support'. For people, not code. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  marketing_unsubscribe_source!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  stripe_customer_id!: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updated_at!: Date;

  @OneToMany('CustomerSubscription', 'customer')
  subscriptions!: CustomerSubscription[];

  @OneToMany('CustomerQuizResult', 'customer')
  quiz_results!: CustomerQuizResult[];

  @OneToMany('CustomerQuizResultPaymentTransaction', 'customer')
  transactions!: CustomerQuizResultPaymentTransaction[];
}
