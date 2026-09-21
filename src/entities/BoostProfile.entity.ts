import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn
} from 'typeorm';
import type { Customer } from './Customer.entity.js';

export interface NotificationPrefs {
  dailyReminder: boolean;
  streakRisk: boolean;
  weeklyRank: boolean;
  newContent: boolean;
}

export const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  dailyReminder: true,
  streakRisk: true,
  weeklyRank: true,
  newContent: false
};

/**
 * The member's training identity.
 *
 * Held apart from `customers` so the funnel's own table needs no migration and
 * no new nullable columns: the funnel owns the account, this owns what the
 * myIQ Cognitive Training Program knows about them. One row per member, created on
 * first sign-in (or by the welcome email) and never by a sign-up form — the
 * platform has no sign-up, by design.
 */
@Entity('boost_profiles')
export class BoostProfile {
  /** Shares the customer's id rather than carrying one of its own: strictly 1:1. */
  @PrimaryColumn({ type: 'bigint' })
  customer_id!: string;

  @OneToOne('Customer', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  /** The certificate number the member bought, e.g. 'MIQ-4821907'. */
  @Column({ type: 'varchar', length: 32, unique: true })
  member_id!: string;

  /**
   * What the leaderboard shows. Never the email address — the leaderboard is
   * the one screen where members see each other.
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  display_name!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  full_name!: string | null;

  @Column({ type: 'smallint', nullable: true })
  birth_year!: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  region!: string | null;

  @Column({ type: 'varchar', length: 10, default: 'en' })
  locale!: string;

  /**
   * An IANA zone. "One attempt per day" and the streak are defined in the
   * member's own local day, so the day has to roll over at their midnight
   * rather than the server's — otherwise a member in Japan gains or loses a day
   * depending on where this happens to be deployed.
   */
  @Column({ type: 'varchar', length: 64, default: 'Asia/Tokyo' })
  timezone!: string;

  /**
   * `customer_quiz_results.iq_score` at the time of purchase. The estimated-IQ
   * figure on the dashboard starts from the certificate the member actually
   * bought and moves with training from there.
   */
  @Column({ type: 'smallint', default: 100 })
  baseline_iq!: number;

  @Column({ type: 'jsonb', default: () => `'${JSON.stringify(DEFAULT_NOTIFICATIONS)}'::jsonb` })
  notifications!: NotificationPrefs;

  /**
   * Caches, recomputed on every submit. `GET /me` runs on every page load and
   * a streak is a walk backwards through the member's days; this is the one
   * place a denormalised counter earns its keep.
   */
  @Column({ type: 'integer', default: 0 })
  streak!: number;

  @Column({ type: 'integer', default: 0 })
  longest_streak!: number;

  @Column({ type: 'integer', default: 0 })
  total_points!: number;

  @Column({ type: 'timestamptz', nullable: true })
  last_seen_at!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updated_at!: Date;
}
