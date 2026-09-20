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
 * One completed run of one brain game.
 *
 * The only thing the games store. The catalogue — titles, rules, durations,
 * star thresholds — stays in code, the same decision as the quiz generators:
 * it is versioned content, not operational data, and a table of it would need a
 * migration every time a blurb changed.
 *
 * Personal best, plays, average and last-played are aggregates over these rows
 * rather than columns on a rollup, so they cannot fall out of step with the runs
 * they describe. What counts as "best" is decided from the catalogue at read
 * time, because it is not MAX for every game: Number Chase is scored in seconds
 * and lower wins.
 */
@Entity('game_runs')
@Index('idx_game_runs_customer_slug', ['customer_id', 'slug'])
@Index('idx_game_runs_customer_date', ['customer_id', 'date_key'])
export class GameRun {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'bigint' })
  customer_id!: string;

  @ManyToOne('Customer', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer!: Customer;

  /**
   * Matches a slug in the code catalogue. Not a foreign key: the thing it refers
   * to is a source file. The API rejects a slug the catalogue does not know, so
   * nothing unrecognised is ever written.
   */
  @Column({ type: 'varchar', length: 40 })
  slug!: string;

  /**
   * In the game's own unit — points, level reached, or seconds. Which one is
   * decided by the catalogue's `scoreMode`, never by the client.
   *
   * One decimal place, because Number Chase is timed and reports tenths. An
   * integer column would round 38.4 to 38 and hand the member a personal best
   * they did not set. Read back as a string by the driver, so every read
   * coerces with `Number()`.
   */
  @Column({ type: 'numeric', precision: 10, scale: 1 })
  score!: string;

  /** Ranking points earned, on a scale comparable across categories. */
  @Column({ type: 'integer', default: 0 })
  points!: number;

  /** The member's local day, so per-day figures agree with the way the quiz counts one. */
  @Column({ type: 'char', length: 10 })
  date_key!: string;

  /**
   * How long the run took, when the client reports it. Nullable, and only ever
   * set on a finished run — quitting part way submits nothing at all.
   */
  @Column({ type: 'integer', nullable: true })
  duration_ms!: number | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  played_at!: Date;
}
