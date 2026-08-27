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
import type { Customer } from './Customer.entity.js';
import type { CustomerQuizResult } from './CustomerQuizResult.entity.js';

@Entity('customer_subscriptions')
export class CustomerSubscription {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  @Index('idx_subscriptions_customer_id')
  customer_id!: string;

  @ManyToOne('Customer', 'subscriptions', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  // A customer can take the quiz more than once, and each attempt carries its own
  // subscription, so the plan is scoped to the quiz result rather than the customer.
  @Column({ type: 'bigint', nullable: true })
  @Index('idx_subscriptions_quiz_result_id')
  customer_quiz_result_id!: string | null;

  @ManyToOne('CustomerQuizResult', 'subscriptions', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'customer_quiz_result_id' })
  quiz_result!: CustomerQuizResult | null;

  @Column({ type: 'varchar', length: 255, unique: true })
  stripe_subscription_id!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  stripe_customer_id!: string | null;

  @Column({ type: 'varchar', length: 50, default: 'active' })
  @Index('idx_subscriptions_status')
  status!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  plan_name!: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2 })
  amount!: string;

  @Column({ type: 'varchar', length: 3, default: 'JPY' })
  currency!: string;

  @Column({ type: 'timestamptz', nullable: true })
  current_period_start!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  current_period_end!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  canceled_at!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  cancel_reason!: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updated_at!: Date;
}
