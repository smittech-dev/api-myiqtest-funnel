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

export type BoostAttemptStatus = 'in_progress' | 'submitted' | 'abandoned' | 'expired';

/** Big Five traits, 0–100 each. Personality attempts only. */
export type TraitProfile = Record<string, number>;

/**
 * One row per quiz run.
 *
 * Deliberately stores no question text, no options and no answer key: only the
 * `seed`. `buildLevel(category, level, seed)` is deterministic, so the twenty
 * questions rebuild identically every time the attempt is opened, and again at
 * submit to mark it. That is also why a retry of the same level sees fresh
 * questions at the same difficulty — the seed moves with `starts_count`.
 */
@Entity('boost_attempts')
/**
 * The daily-limit rule, as a database constraint rather than an application
 * check: one non-practice attempt per member per local day, across all
 * categories. Two tabs racing to press start cannot both win.
 *
 * Declared here as well as in the migration so `synchronize` (used in
 * development) does not drop an index it does not know about.
 */
@Index('uq_boost_attempts_daily', ['customer_id', 'date_key'], {
  unique: true,
  where: 'is_practice = false'
})
@Index('idx_boost_attempts_customer_date', ['customer_id', 'date_key'])
export class BoostAttempt {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  /**
   * The id the client sees, e.g. 'att_x7k2p9qm'.
   *
   * Attempt ids ride in the URL (`/app/boost/play?attempt=…`), and a sequential
   * integer there is an invitation to try the neighbouring numbers. Ownership is
   * checked on every read regardless; this just removes the temptation.
   */
  @Column({ type: 'varchar', length: 32, unique: true })
  public_id!: string;

  @Column({ type: 'bigint' })
  customer_id!: string;

  @ManyToOne('Customer', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  /** memory | numerical | verbal | pattern | personality | attention */
  @Column({ type: 'varchar', length: 20 })
  category!: string;

  @Column({ type: 'smallint' })
  level!: number;

  /**
   * Rebuilds the questions. **Never sent to the client** — with it, a member
   * could run the generator locally and read every answer before submitting.
   */
  @Column({ type: 'varchar', length: 120 })
  seed!: string;

  /** 'YYYY-MM-DD' in the member's timezone, not the server's. */
  @Column({ type: 'char', length: 10 })
  date_key!: string;

  /**
   * A replay of an already-completed level. Costs no daily slot, earns no
   * points and does not touch the streak, so replays cannot be farmed for the
   * leaderboard.
   */
  @Column({ type: 'boolean', default: false })
  is_practice!: boolean;

  @Column({ type: 'varchar', length: 16, default: 'in_progress' })
  status!: BoostAttemptStatus;

  // ── resume state ─────────────────────────────────────────────────────────
  // Autosaved as the member plays. Without these a quiz resumes only in the tab
  // it was started in: the questions rebuild from the seed anywhere, but the
  // answers already given would not travel.

  @Column({ type: 'smallint', default: 0 })
  current_index!: number;

  /** question id → chosen option index, e.g. {"q1": 2, "q2": 0} */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  answers!: Record<string, number>;

  /**
   * Memory questions show their material once, for a fixed time. Recording
   * which have been shown is what stops a second look by reloading the page.
   */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  studied!: string[];

  /**
   * Milliseconds per question. The analytics payload: which questions stall
   * people, which levels run long, where members give up — without storing a
   * single question.
   */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  timing_ms!: Record<string, number>;

  @Column({ type: 'timestamptz', nullable: true })
  last_activity_at!: Date | null;

  // ── outcome ──────────────────────────────────────────────────────────────

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  started_at!: Date;

  /**
   * The member's next local midnight, fixed when the attempt is created.
   * Submitting after it returns 410 — an attempt left open overnight is void,
   * and no scheduled job is needed to make that true.
   */
  @Column({ type: 'timestamptz' })
  expires_at!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  submitted_at!: Date | null;

  @Column({ type: 'integer', nullable: true })
  duration_ms!: number | null;

  @Column({ type: 'smallint', nullable: true })
  correct!: number | null;

  @Column({ type: 'smallint', nullable: true })
  total!: number | null;

  @Column({ type: 'boolean', nullable: true })
  passed!: boolean | null;

  /** Personality has no right answers: it passes on completion. */
  @Column({ type: 'boolean', default: false })
  unscored!: boolean;

  /**
   * True only on the run that first completed this level. A level counts as
   * completed once, however many times it is later passed.
   */
  @Column({ type: 'boolean', default: false })
  first_completion!: boolean;

  @Column({ type: 'integer', default: 0 })
  points!: number;

  /**
   * Big Five result, personality only. Cached rather than recomputed so
   * `GET /boost` need not rebuild a level just to show the profile.
   */
  @Column({ type: 'jsonb', nullable: true })
  profile!: TraitProfile | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updated_at!: Date;
}
