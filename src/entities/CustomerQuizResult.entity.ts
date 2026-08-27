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

  @Column({ type: 'varchar', length: 45, nullable: true })
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
