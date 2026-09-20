import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index
} from 'typeorm';
import type { Customer } from './Customer.entity.js';

/**
 * A password reset link, in flight.
 *
 * Only the hash of the token is stored, exactly as the welcome password is only
 * ever stored hashed: a database dump must not hand over a set of live reset
 * links. The plaintext exists for the length of one request, goes into one
 * email, and is never recoverable.
 */
@Entity('boost_password_resets')
export class BoostPasswordReset {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  @Index('idx_boost_resets_customer')
  customer_id!: string;

  @ManyToOne('Customer', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  /** sha256 of the token that was emailed. */
  @Column({ type: 'char', length: 64, unique: true })
  token_hash!: string;

  @Column({ type: 'timestamptz' })
  expires_at!: Date;

  /** Single use. Also set on every older token when a new one is issued. */
  @Column({ type: 'timestamptz', nullable: true })
  used_at!: Date | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  requested_ip!: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;
}
