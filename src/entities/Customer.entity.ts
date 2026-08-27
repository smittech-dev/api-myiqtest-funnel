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
