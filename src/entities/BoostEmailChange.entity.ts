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
 * A pending change of a member's email address.
 *
 * The address is the sign-in identity, the link to the funnel purchase and
 * where receipts go, so it is not a field the member simply edits. The new
 * address has to prove it is reachable first, and until it does nothing on
 * `customers` moves — which is what stops a typo locking someone out of the
 * account they paid for.
 */
@Entity('boost_email_changes')
@Index('idx_boost_email_changes_customer', ['customer_id', 'created_at'])
export class BoostEmailChange {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  customer_id!: string;

  @ManyToOne('Customer', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  /** Where the account is moving to. Not true yet — that is the point. */
  @Column({ type: 'varchar', length: 255 })
  new_email!: string;

  /**
   * Where it is moving from, captured now so this row still describes what
   * happened after `customers.email` has changed.
   */
  @Column({ type: 'varchar', length: 255 })
  old_email!: string;

  /** sha256 of the emailed token. The plaintext is never stored. */
  @Column({ type: 'char', length: 64, unique: true })
  token_hash!: string;

  @Column({ type: 'timestamptz' })
  expires_at!: Date;

  /** Single use, and stamped on older requests when a newer one supersedes them. */
  @Column({ type: 'timestamptz', nullable: true })
  used_at!: Date | null;

  /** Cancelled by the member, or because the address was claimed by someone else. */
  @Column({ type: 'timestamptz', nullable: true })
  canceled_at!: Date | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  requested_ip!: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;
}
