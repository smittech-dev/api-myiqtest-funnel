-- Email collection moves from a page before checkout to the payment itself.
--
-- Run this BEFORE deploying the code that uses it, unless the server runs with
-- DB_SYNCHRONIZE=true (TypeORM then adds the same columns on boot).
--
-- Additive and nullable throughout: existing rows are untouched, and the old
-- build keeps working against the new schema, so there is no window in which
-- the database and the running code disagree.
--
--   psql -U <user> -d <database> -f db/migrations/2026-11-21_email_collection_flow.sql

BEGIN;

-- The address an Apple Pay / Google Pay sheet handed over, held until either
-- the customer types one on the Personal Detail page (which wins) or
-- pending_email_due_at passes and the replacement job applies it.
ALTER TABLE customer_quiz_results
  ADD COLUMN IF NOT EXISTS pending_email        varchar(255),
  ADD COLUMN IF NOT EXISTS pending_email_due_at timestamptz,
  -- The upsell turned down. Details now come before the upsell, so saving them
  -- no longer settles it; this is what keeps a decliner off the upsell page.
  ADD COLUMN IF NOT EXISTS cross_sell_declined_at timestamptz,
  -- 2 for attempts made through the new funnel; NULL for everything before it.
  -- NULL keeps historical results on the old page order, so no existing
  -- customer is re-routed by this change and nothing needs backfilling.
  ADD COLUMN IF NOT EXISTS funnel_version smallint;

-- The replacement job asks for due rows once a minute.
CREATE INDEX IF NOT EXISTS idx_customer_quiz_results_pending_email_due_at
  ON customer_quiz_results (pending_email_due_at)
  WHERE pending_email_due_at IS NOT NULL;

-- Real addresses are now matched case-insensitively when a placeholder is
-- replaced, so a returning customer is merged rather than duplicated. This
-- index keeps that lookup cheap.
CREATE INDEX IF NOT EXISTS idx_customers_email_lower
  ON customers (LOWER(email));

COMMIT;
