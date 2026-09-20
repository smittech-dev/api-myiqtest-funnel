import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique
} from 'typeorm';
import type { Customer } from './Customer.entity.js';

/**
 * One row per (member, category, level) — the record that says what has been
 * completed and what is therefore unlocked.
 *
 * Unlocking reads only this table: level n is playable once level n-1 has a
 * `passed_at`. Level 1 is always open.
 */
@Entity('boost_level_progress')
@Unique('uq_boost_level', ['customer_id', 'category', 'level'])
export class BoostLevelProgress {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  @Index('idx_boost_progress_customer')
  customer_id!: string;

  @ManyToOne('Customer', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ type: 'varchar', length: 20 })
  category!: string;

  @Column({ type: 'smallint' })
  level!: number;

  /**
   * Every start, including attempts never submitted. Feeds the attempt seed,
   * which is what makes each retry a fresh set of questions at the same
   * difficulty rather than the same twenty again.
   */
  @Column({ type: 'integer', default: 0 })
  starts_count!: number;

  /** Submitted runs only — the figure the level card shows. */
  @Column({ type: 'integer', default: 0 })
  attempts_count!: number;

  @Column({ type: 'smallint', nullable: true })
  best_score!: number | null;

  @Column({ type: 'smallint', nullable: true })
  last_score!: number | null;

  /**
   * Set on the first pass and never cleared: a lower score on a replay must not
   * remove a completion the member has already earned.
   */
  @Column({ type: 'timestamptz', nullable: true })
  passed_at!: Date | null;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updated_at!: Date;
}
