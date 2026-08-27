import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index
} from 'typeorm';
import type { CustomerQuizResult } from './CustomerQuizResult.entity.js';
import type { Customer } from './Customer.entity.js';

@Entity('customer_quiz_result_payment_transactions')
export class CustomerQuizResultPaymentTransaction {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  @Index('idx_transactions_quiz_result_id')
  customer_quiz_result_id!: string;

  @ManyToOne('CustomerQuizResult', 'transactions', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_quiz_result_id' })
  quiz_result!: CustomerQuizResult;

  @Column({ type: 'bigint', nullable: true })
  customer_id!: string | null;

  @ManyToOne('Customer', 'transactions', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer | null;

  @Column({ type: 'varchar', length: 50 })
  transaction_type!: string; // 'first_sale', 'cross_sale', 'subscription', 'refund'

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 3, default: 'JPY' })
  currency!: string;

  // Five decimals, unlike `amount` above. This is a converted figure, not a
  // charged one: rounding a rate-derived value to pennies throws away precision
  // that only matters once these are summed for reporting, and a JPY 2,980 sale
  // is a fraction of a penny either way. `amount` stays at two because that is
  // literally what Stripe took.
  @Column({ type: 'numeric', precision: 15, scale: 5, nullable: true })
  amount_gbp!: string | null;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  @Index('idx_transactions_status')
  status!: string; // 'pending', 'succeeded', 'failed', 'refunded'

  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index('idx_transactions_stripe_pi')
  stripe_payment_intent_id!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  stripe_charge_id!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  refunded_at!: Date | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  refund_amount!: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updated_at!: Date;
}
