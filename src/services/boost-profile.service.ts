import { AppDataSource } from '../config/database.config.js';
import { Customer } from '../entities/Customer.entity.js';
import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';
import { BoostProfile, DEFAULT_NOTIFICATIONS } from '../entities/BoostProfile.entity.js';
import { timezoneForCountry } from '../utils/boost-date.util.js';
import { logger } from '../utils/logger.util.js';
import type { UserDto } from '../types/boost.types.js';

/**
 * The member's training profile.
 *
 * There is no sign-up screen, by design: an account exists because someone
 * bought a certificate through the funnel. So this is never "create a user" —
 * it is "make sure the customer the funnel already created has the extra
 * columns the training programme needs", seeded from their quiz result.
 */

/**
 * The certificate number, derived from the customer id rather than generated.
 *
 * Unique by construction, stable for the life of the account, and reproducible
 * — so support can map a member id back to a customer without a lookup table,
 * and a lost row can be rebuilt with the same number the member has seen.
 */
const memberIdFor = (customerId: string): string => `MIQ-${customerId.padStart(7, '0')}`;

/**
 * Birth year from the funnel's `age`, which is a free-text column.
 *
 * It holds anything the funnel captured: '34', '25-34', or nothing. A plain
 * number converts; a band does not, because the midpoint of a band is a number
 * the member never gave us and would then see echoed back on their profile as
 * fact.
 */
function birthYearFromAge(age: string | null): number | null {
  if (!age) return null;
  const trimmed = age.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;

  const years = Number(trimmed);
  if (years < 5 || years > 120) return null;

  return new Date().getUTCFullYear() - years;
}

const fullNameOf = (q: CustomerQuizResult | null): string | null => {
  const name = [q?.first_name, q?.last_name].filter(Boolean).join(' ').trim();
  return name || null;
};

/**
 * Returns the member's profile, creating it from their funnel record if this is
 * the first time they have signed in.
 *
 * Called from two places on purpose: the welcome email (so new purchases arrive
 * complete) and login (so everyone who bought before this shipped is picked up
 * on their next visit, with no backfill required to have run first). Idempotent,
 * and safe to call concurrently — a duplicate insert loses the race and re-reads.
 */
export async function ensureBoostProfile(customer: Customer): Promise<BoostProfile> {
  const repo = AppDataSource.getRepository(BoostProfile);

  const existing = await repo.findOne({ where: { customer_id: customer.id } });
  if (existing) return existing;

  const quizResult = await AppDataSource.getRepository(CustomerQuizResult).findOne({
    where: { customer_id: customer.id },
    order: { created_at: 'DESC' }
  });

  const profile = repo.create({
    customer_id: customer.id,
    member_id: memberIdFor(customer.id),
    display_name: quizResult?.first_name?.trim() || null,
    full_name: fullNameOf(quizResult),
    birth_year: birthYearFromAge(quizResult?.age ?? null),
    region: null,
    // The members' area is English-only for now; the funnel's `language` is
    // about the funnel's own copy, not this app's.
    locale: 'en',
    timezone: timezoneForCountry(quizResult?.country_code),
    // The certificate they bought is where their estimated IQ starts.
    baseline_iq: quizResult?.iq_score ?? 100,
    notifications: { ...DEFAULT_NOTIFICATIONS },
    streak: 0,
    longest_streak: 0,
    total_points: 0
  });

  try {
    return await repo.save(profile);
  } catch (error: any) {
    // Two requests from the same member arriving together: whoever lost the
    // race just reads what the winner wrote.
    const raced = await repo.findOne({ where: { customer_id: customer.id } });
    if (raced) return raced;

    logger.error(`Could not create boost profile for customer ${customer.id}: ${error?.message ?? error}`);
    throw error;
  }
}

/** The `User` shape the members' app renders. Never carries anything secret. */
export function toUserDto(customer: Customer, profile: BoostProfile): UserDto {
  const displayName = profile.display_name || profile.full_name?.split(' ')[0] || 'Member';

  return {
    id: customer.id,
    email: customer.email,
    name: profile.full_name ?? '',
    displayName,
    birthYear: profile.birth_year,
    region: profile.region ?? '',
    locale: profile.locale,
    memberId: profile.member_id,
    timezone: profile.timezone,
    createdAt: customer.created_at.getTime(),
    passwordChangedAt: customer.password_set_at ? customer.password_set_at.getTime() : null,
    initial: displayName.trim().charAt(0).toUpperCase() || '?',
    notifications: { ...DEFAULT_NOTIFICATIONS, ...(profile.notifications ?? {}) }
  };
}

export interface MemberRecord {
  customer: Customer;
  profile: BoostProfile;
}

/**
 * The customer and their training profile, for a request that has already
 * authenticated.
 *
 * Creates the profile if it is somehow missing rather than failing: a member
 * holding a valid session should never be shown an error because a row they
 * never knew about was not written.
 */
export async function loadMember(customerId: string): Promise<MemberRecord> {
  const customer = await AppDataSource.getRepository(Customer).findOneOrFail({
    where: { id: customerId }
  });

  return { customer, profile: await ensureBoostProfile(customer) };
}
