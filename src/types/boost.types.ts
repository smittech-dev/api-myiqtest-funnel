/**
 * The Boost My IQ contract, as the members' app expects it.
 *
 * These shapes are the API, not an internal convenience: `boost.myiq-test.com`
 * renders them directly and its `API.md` is the specification they implement.
 * Timestamps are epoch milliseconds throughout, because that is what the client
 * does date arithmetic on.
 */

/* ── the question, as far as the client is concerned ──────────────────────── */

/**
 * What `toClient()` leaves of a generated question.
 *
 * Note what is absent: `answer`, `explain`, `trait`, `key`. Those exist on the
 * server-side question object and must never reach here — `npm run check:boost`
 * asserts it on every build.
 */
export interface ClientQuestion {
  id: string;
  type: 'choice' | 'likert';
  prompt: string;
  stimulus?: unknown;
  /** Memory questions only: material shown for `ms`, then gone for good. */
  study?: { kind: string; ms: number; [k: string]: unknown };
  render?: 'text' | 'mono' | 'shape' | 'dots';
  options: unknown[];
}

/* ── attempts ─────────────────────────────────────────────────────────────── */

export interface ClientAttempt {
  id: string;
  category: string;
  level: number;
  dateKey: string;
  practice?: boolean;
  startedAt: number;
  status: string;
  /** Present while the attempt is open; absent once it has been submitted. */
  questions?: ClientQuestion[];
  /** Where the member was, so a resume lands on the right question. */
  progress?: {
    index: number;
    answers: Record<string, number>;
    studied: string[];
    /**
     * Returned as well as stored so time already spent keeps accumulating when
     * the member resumes somewhere else, rather than restarting from zero and
     * under-reporting how long a question really took.
     */
    timing: Record<string, number>;
  };
}

export interface ReviewItem {
  id: string;
  prompt: string;
  stimulus?: unknown;
  render?: string;
  options: unknown[];
  given: number | null;
  answer: number;
  right: boolean;
  explain?: string;
}

export interface AttemptResult {
  category: string;
  level: number;
  correct: number;
  total: number;
  passMark: number;
  passed: boolean;
  unscored: boolean;
  firstCompletion: boolean;
  alreadyCompleted: boolean;
  levelCompleted: boolean;
  nextUnlocked: number | null;
  mastered: boolean;
  practice: boolean;
  points: number;
  profile: Record<string, number> | null;
  review: ReviewItem[];
}

/* ── the Boost overview ───────────────────────────────────────────────────── */

export type LevelStatus = 'completed' | 'available' | 'locked';

export interface LevelSummary {
  level: number;
  name: string;
  status: LevelStatus;
  attempts: number;
  best: number | null;
  lastScore: number | null;
  completedAt: number | null;
}

export interface CategorySummary {
  key: string;
  label: string;
  blurb: string;
  skills: string[];
  unscored: boolean;
  completedLevels: number;
  currentLevel: number;
  mastered: boolean;
  levels: LevelSummary[];
}

export interface TodayState {
  dateKey: string;
  status: 'available' | 'in_progress' | 'done';
  attempt: { id: string; category: string; level: number } | null;
  result: {
    category: string;
    level: number;
    correct: number | null;
    total: number | null;
    passed: boolean | null;
    unscored: boolean;
    points: number;
  } | null;
}

/* ── account ──────────────────────────────────────────────────────────────── */

export interface NotificationPrefsDto {
  dailyReminder: boolean;
  streakRisk: boolean;
  weeklyRank: boolean;
  newContent: boolean;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  displayName: string;
  birthYear: number | null;
  region: string;
  locale: string;
  memberId: string;
  /**
   * IANA zone. Exposed because it decides when the member's day rolls over —
   * and therefore when the daily quiz resets and whether a streak survives — so
   * they need to be able to see and correct it.
   */
  timezone: string;
  createdAt: number;
  passwordChangedAt: number | null;
  initial: string;
  notifications: NotificationPrefsDto;
}

export interface SubscriptionDto {
  id: string;
  userId: string;
  status: string;
  plan: string;
  planLabel: string;
  priceLabel: string;
  startedAt: number | null;
  /** The next billing date, or the date access ends when cancelling. */
  currentPeriodEnd: number | null;
  canceledAt: number | null;
  /**
   * Cancelled, but still inside the period already paid for.
   *
   * `status` is still `active` in this state and access continues, so this is
   * the only thing that tells "cancelling on the 18th" from "renewing on the
   * 18th".
   */
  cancelAtPeriodEnd: boolean;
  /** Days between charges — 28, not a calendar month. */
  intervalDays: number;
  /**
   * When the free trial ends and the first charge lands.
   *
   * Null once the trial is over, or when there never was one. While it is set
   * the member already has full access and has not yet paid anything, which is
   * a different thing to say than "next billing date".
   */
  trialEndsAt: number | null;
  paymentMethod: { brand: string; last4: string; expMonth: number | null; expYear: number | null } | null;
  certificate: { id: string; iq: number; issuedAt: number } | null;
  invoices: { id: string; date: number; label: string; amount: string }[];
}

export interface MemberStats {
  streak: number;
  longestStreak: number;
  points: number;
  estimatedIq: number;
}

/** The authenticated member, attached to the request by the Boost auth guard. */
export interface BoostSession {
  customerId: string;
  email: string;
}
