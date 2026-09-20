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

export type PointsSource = 'boost' | 'game';

/**
 * One row per points award: what was earned, from what, and on which day.
 *
 * Note that nothing currently *reads* this. The leaderboard was going to, but
 * is deliberately demo data (see `boost-demo.service.ts`), and the running total
 * a member sees is the cached `boost_profiles.total_points`.
 *
 * It is kept anyway, for two reasons. It is the only per-day record of points
 * earned, which is the shape any analytics question about engagement needs and
 * cannot be reconstructed later from a running total. And the unique index on
 * `(source, ref_id)` makes paying twice for one attempt impossible however often
 * a submit is retried.
 *
 * Named `member_*` rather than `boost_*` because the brain games belong here too
 * once they have a backend.
 *
 * Practice runs write no row at all — the anti-farming rule made structural
 * rather than remembered.
 */
@Entity('member_points_ledger')
/**
 * Awarding twice for the same attempt is impossible however often a submit is
 * retried. Declared here as well as in the migration so `synchronize` keeps it.
 */
@Index('uq_points_source_ref', ['source', 'ref_id'], {
  unique: true,
  where: 'ref_id IS NOT NULL'
})
@Index('idx_points_customer_date', ['customer_id', 'date_key'])
export class MemberPointsLedger {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  @Index('idx_points_customer')
  customer_id!: string;

  @ManyToOne('Customer', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  @Column({ type: 'varchar', length: 16 })
  source!: PointsSource;

  /** boost_attempts.id, later game_scores.id. Unique per source — see the migration. */
  @Column({ type: 'bigint', nullable: true })
  ref_id!: string | null;

  @Column({ type: 'integer' })
  points!: number;

  /** The member's local day, so a daily leaderboard is an index scan. */
  @Column({ type: 'char', length: 10 })
  @Index('idx_points_date')
  date_key!: string;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;
}
