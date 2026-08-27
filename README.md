# Minimalist Japanese IQ Funnel Backend

A clean, production-ready backend boilerplate built with **Node.js**, **Express**, **TypeScript**, and **TypeORM (PostgreSQL)** for a Japanese IQ funnel.

---

## 🏗️ Architecture & Folder Structure

```
new-funnel-backend/
├── data/
│   ├── discount-codes.json        # Discount codes -> percentages (read at startup)
│   └── quiz/
│       └── scoring.json           # Server-side scoring rubric & weights
├── docs/
│   ├── database-schema.md         # Full database documentation
│   └── schema.sql                 # Ready-to-run PostgreSQL DDL script
├── public/                        # Static funnel test harness served at /app
│   ├── index.html
│   ├── app.js
│   └── style.css
├── src/
│   ├── config/
│   │   ├── env.config.ts          # Validated environment variables
│   │   ├── database.config.ts     # TypeORM AppDataSource connection
│   │   ├── swagger.config.ts      # OpenAPI 3.0 spec served at /docs
│   │   └── swagger.admin.ts       # Admin fragments merged into that spec
│   ├── emails/                    # THE TEMPLATE MASTER
│   │   ├── registry.ts            # Every email the app can send, keyed by template id
│   │   ├── email.types.ts         # The context/parameter contract designs are written against
│   │   ├── layout.ts              # Shared branded HTML shell + escaping/interpolation
│   │   └── templates/             # The designs themselves
│   ├── entities/                  # 11 Finalized Database Entities
│   │   ├── CurrencyRate.entity.ts
│   │   ├── Customer.entity.ts
│   │   ├── CustomerSubscription.entity.ts
│   │   ├── CustomerQuizResult.entity.ts
│   │   ├── CustomerQuizResultPaymentTransaction.entity.ts
│   │   ├── ExternalApiLog.entity.ts
│   │   ├── User.entity.ts
│   │   └── index.ts
│   ├── controllers/               # Express Request Controllers
│   │   ├── quiz.controller.ts
│   │   ├── payment.controller.ts
│   │   ├── customer.controller.ts
│   │   ├── admin-auth.controller.ts
│   │   ├── admin-dashboard.controller.ts
│   │   └── admin-quiz.controller.ts
│   ├── jobs/                      # Scheduled background jobs
│   │   └── currency-rate.job.ts   # 12-hourly exchange-rate refresh (node-cron)
│   ├── services/                  # Business Logic & Integrations
│   │   ├── quiz.service.ts
│   │   ├── payment.service.ts
│   │   ├── currency-rate.service.ts
│   │   ├── email-verification.service.ts
│   │   ├── customer.service.ts
│   │   ├── external-api-log.service.ts
│   │   ├── admin-auth.service.ts
│   │   ├── admin-dashboard.service.ts
│   │   └── admin-quiz.service.ts
│   ├── routes/                    # API Routing & Zod Validation
│   │   ├── quiz.routes.ts
│   │   ├── payment.routes.ts
│   │   ├── customer.routes.ts
│   │   ├── admin.routes.ts        # All /admin routes + Zod schemas
│   │   └── index.ts
│   ├── middlewares/               # Express Middlewares
│   │   ├── error.middleware.ts    # Global error handler
│   │   ├── validation.middleware.ts # Zod validator
│   │   ├── api-key.middleware.ts  # x-api-key gate (skips /admin and the webhook)
│   │   ├── admin-auth.middleware.ts # Admin bearer-token gate
│   │   └── request-logger.middleware.ts
│   ├── types/                     # TypeScript Interfaces & DTOs
│   │   ├── api-response.types.ts
│   │   ├── quiz.types.ts
│   │   └── admin.types.ts
│   ├── utils/                     # Helpers
│   │   ├── api-response.util.ts
│   │   ├── app-error.util.ts
│   │   ├── jwt.util.ts            # Signs/verifies the 60-day admin token
│   │   ├── password.util.ts       # bcrypt hashing for admin credentials
│   │   ├── date-range.util.ts     # Shared from/to parsing for admin filters
│   │   └── logger.util.ts
│   ├── scripts/
│   │   └── create-admin.ts        # npm run create:admin (no registration endpoint)
│   ├── app.ts                     # Express App Initialization
│   └── server.ts                  # Server & Database Bootstrap
├── .env.example
├── tsconfig.json
└── package.json
```

---

## 🗄️ Database Tables (11 Final Tables)

1. **`customers`**: Customer email, password hash for login, and Stripe customer ID.
2. **`customer_subscriptions`**: Dedicated table managing customer recurring subscriptions, plan name, billing period, and status.
3. **`customer_quiz_results`**: Core attempt record (email, demographics, score, duration, landing attribution, report URLs).
4. **`customer_quiz_result_payment_transactions`**: Stripe payment transactions (first-sale, cross-sell/upsell, refunds, JPY/GBP currency amounts).
5. **`currency_rates`**: JPY to GBP exchange rates for financial normalization and dynamic pricing.
6. **`external_api_logs`**: Outgoing/incoming third-party API logs (Stripe, webhooks, email).
7. **`users`**: Admin/internal backoffice users.
8. **`email_marketing_logs`**: One row per (customer, marketing step) — the record that stops a customer receiving the same nudge twice.
9. **`email_marketing_settings`**: Singleton row of sequence-wide options (on/off, batch size, retry limit, age guard).
10. **`email_marketing_steps`**: One row per rung of the discount ladder — delay, discount code, template.
11. **`email_transactional_logs`**: Delivery record for the welcome and report-ready emails, deduped per purchase.

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` and set your PostgreSQL and Stripe credentials:
```bash
cp .env.example .env
```

### 3. Create the Database & Schema
```bash
psql -U postgres -c "CREATE DATABASE iq_funnel;"
```

Then create the tables either way:

- **TypeORM sync (development)** — set `DB_SYNCHRONIZE=true` in `.env` and the entities are
  created/altered on every boot. Convenient, but it will drop columns you remove from an entity.
- **SQL script** — set `DB_SYNCHRONIZE=false` and run the DDL yourself:
  ```bash
  psql -U postgres -d iq_funnel -f docs/schema.sql
  ```

### 4. Start Development Server
```bash
npm run dev
```

### 5. Build & Start Production Server
```bash
npm run build
npm start
```

---

## 📡 API Endpoints

| # | Method | Route | Description |
|---|---|---|---|
| 1 | `POST` | `/questions/submit` | Submit quiz score, create inactive customer, return encrypted `quiz_id` |
| 2 | `GET` | `/questions/results?quiz_id=` | Redirect guard — resolve which page the user belongs on |
| 3 | `GET` | `/price?language=ja&price_dis=<code>` | Funnel prices, first sale optionally discounted |
| 4 | `POST` | `/payment/first-sale/create-payment-intent` | Create Stripe PaymentIntent for First Sale (accepts `price_dis`) |
| 5 | `POST` | `/payment/first-sale/payments/confirm` | Settle the first sale as soon as the browser confirms it |
| 6 | `POST` | `/payment/cross-sale/confirm` | Charge the saved card for the upsell (no payment sheet) |
| 7 | `POST` | `/payment/webhook` | Unified Stripe webhook (confirms first sale, cross sale, subscriptions) |
| 8 | `PUT` | `/customer/update` | Update customer demographics (name, age, gender) |
| 9 | `POST` | `/admin/auth/login` | Admin sign in — see [Admin Panel API](#admin-panel-api-admin) |
| 10 | `GET` | `/admin/dashboard/stats` | Admin dashboard KPIs (date-range filtered) |
| 11 | `GET` | `/admin/quiz-submissions` | Admin quiz submission list (search + filters) |
| 12 | `GET` | `/admin/quiz-submissions/:id` | Admin quiz submission detail |

**First sale:** `create-payment-intent` returns a `client_secret` and records a `pending` transaction.
The frontend confirms with Stripe.js, then immediately calls `first-sale/payments/confirm`, which
re-reads the PaymentIntent from Stripe, settles the transaction, activates the customer, and returns
the recomputed `redirect_url`. **The funnel does not wait on the webhook**, which can be delayed —
the webhook still fires and applies the same state idempotently, so whichever lands first wins.
The intent is created against a Stripe Customer with `setup_future_usage: 'off_session'`, so the card
is stored for the upsell.

**Cross-sale:** one click, no payment sheet. `POST /payment/cross-sale/confirm` charges the card saved
by the first sale off-session (`confirm: true`) and settles the transaction in the same request, so it
does not depend on the webhook. It requires a succeeded first sale, is safe to call twice, and if the
saved card demands 3D Secure it returns `requires_action` + `client_secret` for the browser to finish.

### Admin Panel API (`/admin`)

Consumed by the `new-funnel-admin` React panel. Every route below is guarded by an
**admin bearer token**, not the funnel `x-api-key` — the panel runs in a browser, so
requiring the shared key there would mean shipping it to every visitor.
`/admin/*` is therefore exempted from `apiKeyAuth`.

| # | Method | Route | Auth | Description |
|---|---|---|---|---|
| 1 | `POST` | `/admin/auth/login` | — | Exchange email + password for a 60-day token |
| 2 | `GET` | `/admin/auth/me` | Bearer | Current admin profile (restores a session on reload) |
| 3 | `POST` | `/admin/auth/logout` | Bearer | Tells the client to discard its token (tokens are stateless) |
| 4 | `GET` | `/admin/dashboard/stats` | Bearer | The four dashboard KPIs, date-range filtered |
| 5 | `GET` | `/admin/quiz-submissions` | Bearer | Paginated submission list with search + filters |
| 6 | `GET` | `/admin/quiz-submissions/:id` | Bearer | One submission: quiz, customer, transactions, subscriptions |
| 7 | `POST` | `/admin/currency-rates/sync` | Bearer | Refresh exchange rates on demand |
| 8 | `GET` | `/admin/email-marketing/config` | Bearer | Sequence settings + template master + discount codes + transport status |
| 9 | `PUT` | `/admin/email-marketing/config` | Bearer | Save the sequence settings |
| 10 | `GET` | `/admin/email-marketing/logs` | Bearer | Paginated send history, filterable by step and status |
| 11 | `GET` | `/admin/email-marketing/stats` | Bearer | Sent / failed / skipped counts, in total and per step |
| 12 | `POST` | `/admin/email-marketing/run` | Bearer | Run the sequence immediately |
| 13 | `POST` | `/admin/email-marketing/test-send` | Bearer | Send one template to an address with sample data |

**Admin users** live in the existing `users` table. `role` is always `admin` — there is no
role management. **Email is the login credential** (`users.email` is the unique column).

**Sessions are 60 days** (`ADMIN_JWT_EXPIRES_IN=60d`). Because that is a long window, the
guard re-reads the user row on every request instead of trusting the token: setting
`users.status` to anything other than `active` locks the operator out on their next call
rather than two months later. There is no refresh-token flow — the panel just keeps the
token until it lapses.

#### Provisioning admins

There is no registration or password-reset endpoint by design. Accounts are created on the
server:

```bash
# create
npm run create:admin -- --name "Jane Doe" --email jane@example.com --password "s3cret!!"

# reset an existing admin's password
npm run create:admin -- --reset --email jane@example.com --password "newpass!!"
```

Passwords are bcrypt-hashed (`ADMIN_BCRYPT_ROUNDS`, default 10) and must be 8+ characters.
This is deliberately separate from `customers.password_hash`, which the funnel fills with a
throwaway sha256 value — customers never log in.

#### `GET /admin/dashboard/stats`

`?from=YYYY-MM-DD&to=YYYY-MM-DD` — both optional; omit for all time. A bare date is widened
to the whole UTC day, so a single-day filter returns that day. A full ISO timestamp is
honoured as given.

```json
{ "success": true, "data": {
  "total_quiz_submitted": 84, "total_first_sale": 40,
  "total_cross_sale": 16, "total_active_subscription": 13 } }
```

All four counts are **cohorted on the quiz submission date** — "of the quizzes submitted in
this window, how many produced a first sale, a cross sale, an active subscription". That
keeps the numbers comparable, so a conversion rate taken across them means something. It
does mean `total_first_sale` is *not* "charges that settled in this window"; in this funnel
the sale lands minutes after the quiz, so the two readings barely differ.

Only `succeeded` transactions count as a sale — refunded and failed ones do not.

#### `GET /admin/quiz-submissions`

| Param | Values | Default |
|---|---|---|
| `search` | exact numeric quiz id, or partial case-insensitive email | — |
| `status` | `all` \| `first_sale` \| `cross_sale` \| `subscription` \| `no_purchase` | `all` |
| `language` | `all` \| `ja` \| `en` | `all` |
| `from` / `to` | `YYYY-MM-DD` or ISO timestamp | all time |
| `page` | 1+ | `1` |
| `page_size` | 1–100 | `10` |

Returns `{ items, total, page, page_size, total_pages }`, newest first. Each item carries the
quiz fields plus `revenue`, `has_first_sale`, `has_cross_sale`, `first_sale_amount`,
`cross_sale_amount`, and `subscription_status`.

The purchase filters are `EXISTS` subqueries rather than joins, so a quiz with several
transactions still counts once and `page_size` stays honest. Only the current page's ids are
then hydrated with transactions and subscriptions — three queries regardless of table size.

#### `GET /admin/quiz-submissions/:id`

Takes the **raw numeric** quiz id, not the encrypted funnel `quiz_id`. Returns
`{ quiz, customer, transactions, subscriptions }`. The customer is mapped field by field so
`password_hash` can never reach the panel.

### Funnel Test Harness (`/app`)

A dependency-free HTML/JS page that drives the whole funnel against the real API, so you can click
through submit → checkout → cross-sell → details → result with Stripe test cards.

```bash
# .env
DEMO_UI_ENABLED=true
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

Then start the server and open <http://localhost:5000/app>.

**The Stripe CLI is optional now.** The confirm endpoints settle each sale synchronously, so the funnel
advances on its own. Run the listener anyway if you want to exercise the webhook path as well:

```bash
stripe listen --forward-to localhost:5000/payment/webhook
```

Test cards: `4242 4242 4242 4242` (succeeds), `4000 0025 0000 3155` (3D Secure), any future expiry/CVC.

The right-hand panel logs every API call with its status and body. If `API_KEY` is set on the server,
paste it into the `x-api-key` field — the page never receives the key from the server, by design.
Set `DEMO_UI_ENABLED=false` (the default in `.env.example`) to remove the route entirely.

### Email verification (reoon.com)

When an email is first captured by `POST /questions/submit`, it is checked with
[Reoon](https://reoon.com) and the outcome stored in `customers.email_verified`.

| Variable | Default | Purpose |
|---|---|---|
| `EMAIL_VERIFICATION_ENABLED` | `false` | Master on/off switch |
| `REOON_API_KEY` | — | Your Reoon API key (required when enabled) |
| `REOON_API_URL` | `https://emailverifier.reoon.com/api/v1/verify` | Endpoint |
| `REOON_MODE` | `quick` | `quick` (syntax/MX/disposable) or `power` (adds SMTP checks, slower) |
| `EMAIL_VERIFICATION_MIN_SCORE` | `80` | Reoon `overall_score` at or above which the email counts as verified |
| `EMAIL_VERIFICATION_TIMEOUT_MS` | `8000` | Abort the provider request after this long |

Behaviour notes:

- **Best-effort, never blocking.** A provider outage, timeout, bad key or HTTP error leaves
  `email_verified = false` and the quiz submission still succeeds — verification failing is not a
  reason to lose the lead.
- The decision is score-based: `overall_score >= EMAIL_VERIFICATION_MIN_SCORE`. If Reoon omits the
  score, it falls back to `status === 'valid'`.
- An already-verified customer is **not re-checked** on later submissions, so repeat quiz attempts
  do not burn extra credits.
- With the switch off no request is made at all and the column stays `false`.

### First-sale discounts

`GET /price?language=ja&price_dis=<code>` returns all three funnel prices with the discount applied
to the **first sale**. The frontend passes the same `price_dis` to `create-payment-intent`, and the
PaymentIntent — and therefore the Stripe charge and the stored transaction — is created for the
discounted amount.

**Codes live in [`data/discount-codes.json`](data/discount-codes.json)**, not in the environment,
keyed by code:

```json
{
  "K75QSQC": { "code": "K75QSQC", "discount": 20 }
}
```

Each `discount` is a percentage between 1 and 99. The file is read **once at startup**, so editing
it requires a restart. Invalid entries are skipped with a warning rather than taking the app down; a
missing file means every code is rejected.

- **The frontend sends a code, never a percentage.** Codes map to percentages only in this file, so
  a client cannot invent its own discount.
- **Personalised codes** are supported: the first two letters of the customer's email plus an
  underscore may prefix the code (`pu_K75QSQC`). The plain form is matched first, and only if that
  fails and the value looks prefixed are the leading three characters dropped and the lookup retried
  — so a configured code is never mangled by the prefix rule. Matching is case-insensitive.
- **The code is revalidated server-side** on `create-payment-intent`, not just on `/price`. Anything
  unrecognised is rejected with 400.
- Only the first sale is discountable. The cross-sale and subscription are charged at list price by
  their own endpoints, so `/price` reports them at list price rather than showing a discount that
  would never be honoured.
- Rounding is done on the Stripe amount first and the display price derived from it, so what the UI
  shows can never disagree with what Stripe charges. JPY is zero-decimal, GBP is pence.
- The PaymentIntent carries `discount_code`, `discount_percentage` and `original_amount` in its
  metadata for reconciliation.

### Subscription on the first sale

When the first sale is confirmed, the backend also starts the recurring plan on the **same card the
customer just used** — no second payment sheet. It runs inside
`POST /payment/first-sale/payments/confirm` and is reported in that response's `subscription` block.

| Variable | Default | Purpose |
|---|---|---|
| `SUBSCRIPTION_ENABLED` | `false` | Master on/off switch |
| `STRIPE_SUB_PRICE_ID_JA` | — | Static Stripe Price id used for `ja` (JPY) |
| `STRIPE_SUB_PRICE_ID_EN` | — | Static Stripe Price id used for `en` (GBP) |

Behaviour notes:

- **Best-effort by design.** The customer has already been charged for the first sale, so a
  subscription failure is logged and returned as `subscription.reason` — it never fails the request
  or strands the funnel.
- Skipped with a clear reason when the switch is off, when no Price id is configured for the funnel
  language, or when the first sale saved no reusable card.
- One subscription per customer: repeat confirm calls return the existing one instead of creating another.
- The saved card is set as the customer's `invoice_settings.default_payment_method`, so renewals charge it.
- The local `customer_subscriptions` row is written immediately and refreshed by the
  `customer.subscription.*` webhooks through the same upsert, so the two never diverge.

### Currency Rate Sync

Exchange rates are refreshed from [exchangeratesapi.io](https://exchangeratesapi.io) on a cron schedule
and stored in `currency_rates`. **GBP is the base currency and is always stored as `1`**; every other
row holds `rate_to_gbp` = how many units of that currency equal 1 GBP (e.g. JPY `216.804321`).

The provider's free plan only issues EUR-based quotes, so the sync requests `base=EUR`, divides every
returned rate by the EUR quote for GBP, and stores the GBP-based result. `EXCHANGERATES_API_BASE`
exists for the case where a paid plan makes that hop unnecessary.

| Variable | Default | Purpose |
|---|---|---|
| `CURRENCY_SYNC_ENABLED` | `false` | Master on/off switch for the cron |
| `EXCHANGERATES_API_KEY` | — | Your exchangeratesapi.io access key (required when enabled) |
| `EXCHANGERATES_API_URL` | `https://api.exchangeratesapi.io/v1` | API base URL |
| `CURRENCY_SYNC_CRON` | `0 */12 * * *` | Every 12 hours — 00:00 and 12:00 |
| `CURRENCY_SYNC_TIMEZONE` | `UTC` | Timezone the cron expression is evaluated in |
| `CURRENCY_SYNC_ON_STARTUP` | `false` | Run one refresh at boot instead of waiting for the first tick |
| `EXCHANGERATES_API_BASE` | `EUR` | Base requested from the provider before the local rebase onto GBP |
| `CURRENCY_REQUEST_TIMEOUT_MS` | `10000` | Abort the provider request after this long |

Behaviour notes:

- The free exchangeratesapi.io plan serves EUR quotes only, so the sync asks for `base=EUR` and
  **rebases every rate on GBP itself** (`rate / rates.GBP`). This is correct whichever base the
  provider actually returns, and `source_base` reports what that was.
- A failed sync never crashes the process and never wipes existing rates — the last good values stay
  in the table until a later run succeeds.
- Overlapping runs are suppressed, so a slow provider cannot stack up jobs.
- With `CURRENCY_SYNC_ENABLED=false` (the default) no cron is registered at all.

### Email sending (ZeptoMail)

Every email the application sends goes through [ZeptoMail](https://www.zoho.com/zeptomail/),
addressed by a **template id** from the template master. Callers never touch HTML, headers or
the provider payload — they name a template and hand over a context.

| Variable | Default | Purpose |
|---|---|---|
| `ZEPTOMAIL_ENABLED` | `false` | Master on/off switch for outbound mail |
| `ZEPTOMAIL_API_URL` | `https://api.zeptomail.com/v1.1/email` | `.com` global datacenter, `.eu` for Europe |
| `ZEPTOMAIL_TOKEN` | — | The send-mail token, including its `Zoho-enczapikey ` prefix |
| `ZEPTOMAIL_FROM_ADDRESS` | — | Sender, on a domain verified in your ZeptoMail account |
| `ZEPTOMAIL_FROM_NAME` | `MyIQTest` | Sender display name |
| `ZEPTOMAIL_REPLY_TO` | — | Optional reply-to address |
| `ZEPTOMAIL_TRACK_OPENS` / `_CLICKS` | `true` | Provider-side tracking |
| `EMAIL_REQUEST_TIMEOUT_MS` | `10000` | Abort the provider request after this long |
| `EMAIL_DRY_RUN` | `false` | Render and log each message without delivering it |

Every call is recorded in `external_api_logs` under `zeptomail`, with the rendered HTML body
replaced by a size marker — a 40KB email per send would otherwise make that the largest table
in the database within a week.

Sending **never throws**. A provider outage returns `{ status: 'failed', error }` so the
marketing run can record the reason and carry on with the next recipient.

### The template master

`src/emails/registry.ts` lists every email the application can send, exactly once, keyed by a
stable template id. Nothing else in the codebase names an email: a marketing step stores
`template_id`, the send log records `template_id`, the admin panel offers the list in a
dropdown, and the transport looks the design up there.

**Adding an email** — marketing or transactional — is a design file plus one line in
`TEMPLATES`. Nothing downstream changes.

What is in it today:

| Template id | Category | Sent when |
|---|---|---|
| `marketing_reminder_day1` … `day5` | marketing | The abandoned-checkout ladder (see below) |
| `transactional_welcome` | transactional | The first sale settles — carries the brain training credentials |
| `transactional_report_ready` | transactional | The customer finishes the funnel — links their reports |

`category` is what separates them in the admin panel: the marketing step picker offers only
marketing designs, while **Send a test** offers everything, because an operator needs to
preview a welcome email as much as a discount nudge.

It is code and config rather than a database table on purpose. These are versioned artefacts:
a design belongs in the same commit as the copy it renders and the parameters it declares, and
"which templates exist" must not be able to differ between two environments running the same
build. What *is* operational — which template a step uses, and whether it is on — lives in
the `email_marketing_steps` table, editable from the panel without a deploy.

Each entry declares:

| Field | Meaning |
|---|---|
| `id` | Stable handle. Renaming the design is safe; changing the id is not |
| `name` / `description` | What the admin template picker shows |
| `category` | `marketing` or `transactional` — the step picker filters on it |
| `params` | The dynamic parameters the design consumes, declared rather than inferred |
| `subject` | Per-language subject line, supporting `{{param}}` placeholders |
| `render` | Produces the HTML body |

**Two rendering paths, one id.** By default the design in `src/emails/templates` renders the
HTML and the transport posts it to `/v1.1/email`. Set `ZEPTOMAIL_TEMPLATE_<ID_UPPERCASE>` and
ZeptoMail renders its own hosted template of that key instead, receiving the declared
parameters as `merge_info` at `/v1.1/email/template`:

```bash
ZEPTOMAIL_TEMPLATE_MARKETING_REMINDER_DAY1=2518b.53ab...
```

Both paths take the same template id and the same parameters, so moving a design into
ZeptoMail's editor is one environment variable and no code change. The admin panel flags which
templates are hosted, so nobody edits copy in this repo that has no effect.

Designs are bilingual (`ja` / `en`) and table-based with inline styles — deliberately
old-fashioned HTML, because that is what renders the same in twenty email clients.

### Email marketing (abandoned checkout sequence)

Every five minutes, the sequence finds people who **took the quiz**, whose **email verified**,
who **never completed the first sale**, and sends them the one discount email they are due.

The sequence lives in two tables — `email_marketing_settings` (one row of global options) and
`email_marketing_steps` (one row per rung). The application **seeds them on first boot** if
they are empty, with the sequence disabled, so a fresh environment comes up with a working
ladder that sends nothing until someone switches it on:

| Step | Delay | Discount | Template |
|---|---|---|---|
| `step_24h` | 24 hours | 20% | `marketing_reminder_day1` |
| `step_48h` | 48 hours | 20% | `marketing_reminder_day2` |
| `step_72h` | 72 hours | 50% | `marketing_reminder_day3` |
| `step_5d` | 5 days | 50% | `marketing_reminder_day5` |

| Variable | Default | Purpose |
|---|---|---|
| `EMAIL_MARKETING_ENABLED` | `false` | Whether the cron is registered at all |
| `EMAIL_MARKETING_CRON` | `*/5 * * * *` | Every five minutes |
| `EMAIL_MARKETING_TIMEZONE` | `UTC` | Timezone the expression is evaluated in |
| `EMAIL_MARKETING_STUCK_CLAIM_MINUTES` | `30` | Release a step claimed by a runner that then died |

**Two switches, on purpose.** `EMAIL_MARKETING_ENABLED` decides whether the schedule exists —
ops keeps a hard off switch that does not depend on the database being reachable.
`email_marketing_settings.enabled` decides whether a registered run actually sends, which is
what "stop the emails, now" needs to mean from the admin panel.

#### Who is eligible

- The customer's `email_verified` is `true` — unverified addresses are never contacted.
- No `first_sale` transaction with status `succeeded` exists for **any** of their quizzes.
  (The check walks transactions through `customer_quiz_results`, because
  `transactions.customer_id` is nullable and the quiz link is the one always populated.)
- Their most recent quiz is older than the first step's delay, and newer than `max_age_hours`.
- They have not already been through every enabled step.

Repeat quiz-takers collapse to **one** candidate — `DISTINCT ON (customer_id)`, timed from
their latest attempt. The sequence is addressed to a person, not to a submission.

#### The two rules that matter

**One person, one step, ever.** `email_marketing_logs` has a unique index on
`(customer_id, step_key)`, and the runner **claims a step by inserting that row before it calls
the provider** (`ON CONFLICT DO NOTHING`). A check-then-send would race two ticks against each
other and double-send; an insert cannot. This is what answers "the same customer must not
repeat at 24 and 48 both".

**The ladder is caught up to, not walked through.** When several steps are due at once — the
sequence was off, the server was down, the quiz predates the feature — the runner sends the
**latest** due step and marks the earlier ones `skipped` with a `skip_reason`. Someone four
days past their quiz gets the 50% email today, not the 20% email today and the rest over the
next fifteen minutes.

#### The link customers click

The CTA carries the encrypted quiz id and the discount code as query parameters the funnel
already understands:

```
{FRONTEND_URL}/{ja|en}/checkout?quiz_id={encrypted}&price_dis={CODE}
```

So the customer lands on checkout with their session restored and the discount already in the
quoted price — nothing to type.

#### Failure handling

A failed send is retried on later ticks until `max_attempts`, then abandoned. A step claimed by
a process that died is released after `EMAIL_MARKETING_STUCK_CLAIM_MINUTES`. A run never throws
and overlapping runs are suppressed, so a slow provider cannot stack up jobs.

#### Configuring it from the admin panel

**Email Marketing** in the panel edits all of it: the master switch, each step's on/off state,
delay, discount code and template, plus batch size, retry limit and the `max_age_hours` guard.
Steps can be added and removed — a new one arrives **disabled**, a day after the last rung, so
saving it cannot start emailing whoever already qualifies.
It also shows send counts, recent activity with failure reasons, a **Run now** button, and a
**Send a test** box that delivers a design to your own inbox **without writing a tracking
row** — so a test never consumes anyone's place in the sequence.

Saving replaces the ladder wholesale, in one transaction, and validates first — a step's delay
only means something against the other steps' delays, so the schema has to see all of them at
once. It rejects: an unknown template id, a discount code missing from
`data/discount-codes.json`, duplicate step keys, two enabled steps sharing a delay, and an
enabled step whose template writes the discount into its copy but has no code selected.

Removing a step deletes its row but **leaves its send history**, because `email_marketing_logs`
references `step_key` as a plain string with no foreign key — deleting a retired step must
neither erase the record of what it sent nor be blocked by it. For the same reason a step's key
is fixed once created: renaming it would orphan that history and the rung would be sent again
to everyone. The label carries anything an operator wants to reword.

Changes take effect on the next tick — no restart, and nothing is cached in the process, so an
edit made on one instance is honoured by whichever instance happens to run the cron.

### Transactional email (welcome + report ready)

Two messages go to customers who actually paid. Neither is optional or scheduled — each is the
delivery of something bought — so they are triggered by the funnel itself rather than by a cron.

| Variable | Default | Purpose |
|---|---|---|
| `TRANSACTIONAL_EMAIL_ENABLED` | `false` | Master switch for both messages |
| `TRANSACTIONAL_EMAIL_MAX_ATTEMPTS` | `3` | Provider calls per message before it is given up on |
| `BRAIN_TRAINING_NAME` | `Brain Training Program` | What the welcome email calls the programme |
| `BRAIN_TRAINING_LOGIN_URL` | — | Where the credentials are used; falls back to `FRONTEND_URL` |

#### 1. Welcome — when the first sale settles

Triggered from `settleTransactionFromIntent` in `payment.service.ts`, which is the single point
both the confirm endpoint and the Stripe webhook settle through — so the email is sent once no
matter which of them arrives first. Gated on `transaction_type === 'first_sale'`: that method
also settles cross-sale and subscription intents, and those are not a new account.

It carries the customer's sign-in details for the brain training programme the subscription
unlocks:

- A password is **generated**, not chosen — the funnel asks for a card, never a password, so the
  account has to arrive already usable. Twelve characters from an unambiguous alphabet
  (`K7MP-3QRT-9XYZ`), no `0/O` or `1/I/L`, because the case to optimise for is someone retyping
  it from their phone.
- Only the **bcrypt hash** is stored, in `customers.password_hash`. The plaintext exists for the
  length of one request and is never written anywhere — a customer who loses the email needs a
  reset, not a lookup, and support genuinely cannot read it back.
- `customers.password_set_at` records that it happened. Without it, a returning customer's second
  purchase would silently reset the password they are already using; with it, the welcome email
  is sent carrying a "your existing password still works" note instead of new credentials.

#### 2. Report ready — when the customer finishes the funnel

Triggered from `updateCustomerDetails` in `customer.service.ts` — saving a first and last name is
what moves `resolveFunnelRedirect` to `THANK_YOU_PAGE`, so it is the moment the report is
genuinely finished.

**This is the only workable trigger, not a preference.** The upsell comes *after* the first sale
in the funnel, so an email sent on payment could never know whether the cross-sale report exists.

It carries one button per report the customer actually owns:

- The first-sale report (certificate and detailed analysis) — always.
- The cross-sale career and aptitude report — **only when that upsell was paid.** The entitlement
  is read from succeeded transactions rather than passed in, so the email cannot offer a document
  the customer has not bought.

Each link prefers a stored file from `customer_quiz_results.report_urls` — the column exists for
generated PDFs — and falls back to the funnel page that renders the report live
(`/{locale}/result` and `/{locale}/result/report`). The day PDF generation is added, these emails
start linking to the files with no change to the email code. The encrypted `quiz_id` rides the
query string either way, because those pages are session-guarded and a link opened days later in
a different browser has no session to restore from.

#### Delivered without blocking anything

Both sends are dispatched with `void` and swallow every failure. A payment must not fail because
ZeptoMail was slow, and a Stripe webhook must not be pushed towards its timeout — that would have
Stripe retry the event and settle it all over again.

Both are also **claimed before they are sent**: a row with a UNIQUE `dedup_key`
(`welcome:1042`, `report_ready:1042`) goes into `email_transactional_logs` first, so two triggers
racing on one payment produce one email and one no-op. A failed send is retried by a later
trigger until `TRANSACTIONAL_EMAIL_MAX_ATTEMPTS`.

`email_transactional_logs` is deliberately separate from `email_marketing_logs` because the two
dedupe on different things: a marketing step is once per **person** (three quizzes, one 24-hour
nudge), a transactional email is once per **purchase** (a customer who returns and buys again has
bought a second report and must be sent it).

### Swagger / OpenAPI

Interactive docs are served once the app is running:

| URL | Purpose |
|---|---|
| `http://localhost:5000/docs` | Swagger UI — browse and call every endpoint |
| `http://localhost:5000/docs.json` | Raw OpenAPI 3.0 spec (import into Postman/Insomnia) |

The spec lives in [`src/config/swagger.config.ts`](src/config/swagger.config.ts) and is mounted
before the API-key middleware, so the docs stay reachable even when `API_KEY` is set. If it is set,
click **Authorize** in Swagger UI and enter the key to send the `x-api-key` header.

`POST /payment/webhook` is listed for reference only — it verifies a Stripe signature and cannot be
called from the UI. Use the Stripe CLI instead:
```bash
stripe listen --forward-to localhost:5000/payment/webhook
```
