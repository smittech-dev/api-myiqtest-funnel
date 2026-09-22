/** Shapes returned by the /admin endpoints, consumed by the admin panel UI. */

export interface AdminUserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

export interface AdminLoginResult {
  token: string;
  token_type: 'Bearer';
  expires_in: number; // seconds
  user: AdminUserProfile;
}

export interface DateRangeFilter {
  from?: Date;
  to?: Date;
}

export interface AdminDashboardStats {
  total_quiz_submitted: number;
  total_first_sale: number;
  total_cross_sale: number;
  total_active_subscription: number;
}

export type AdminQuizStatusFilter =
  | 'all'
  | 'first_sale'
  | 'cross_sale'
  | 'subscription'
  | 'no_purchase';

export interface AdminQuizListQuery extends DateRangeFilter {
  search?: string;
  status?: AdminQuizStatusFilter;
  language?: 'all' | 'ja' | 'en';
  page: number;
  page_size: number;
}

export interface AdminQuizListItem {
  id: string;
  customer_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  age: string | null;
  gender: string | null;
  iq_score: number | null;
  duration_seconds: number | null;
  language: string;
  country_code: string;
  landing_url_details: Record<string, any> | null;
  created_at: Date;
  revenue: string;
  has_first_sale: boolean;
  has_cross_sale: boolean;
  first_sale_amount: string | null;
  cross_sale_amount: string | null;
  subscription_status: string | null;
}

export interface AdminPaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** Customer fields safe to show an admin — never the password hash. */
export interface AdminCustomerSummary {
  id: string;
  email: string;
  email_verified: boolean;
  status: string;
  stripe_customer_id: string | null;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Email marketing
// ---------------------------------------------------------------------------

export type AdminEmailMarketingLogStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface AdminEmailMarketingLogQuery extends DateRangeFilter {
  /** A step key from the config, or 'all'. */
  step_key?: string;
  status?: AdminEmailMarketingLogStatus | 'all';
  /** Partial, case-insensitive recipient address. */
  search?: string;
  page: number;
  page_size: number;
}

/** One row of the admin activity table. */
export interface AdminEmailMarketingLogItem {
  id: string;
  customer_id: string;
  customer_quiz_result_id: string | null;
  email: string;
  step_key: string;
  template_id: string;
  /** Resolved from the template master for display; the row stores only the id. */
  template_name: string;
  discount_code: string | null;
  language: string;
  status: AdminEmailMarketingLogStatus;
  provider_message_id: string | null;
  error_message: string | null;
  skip_reason: string | null;
  attempts: number;
  sent_at: Date | null;
  created_at: Date;
}

export interface AdminEmailMarketingStatusCounts {
  sent: number;
  failed: number;
  skipped: number;
  pending: number;
}

export interface AdminEmailMarketingStats {
  totals: AdminEmailMarketingStatusCounts;
  /** Step key -> its own counts, so the editor can annotate each rung. */
  by_step: Record<string, AdminEmailMarketingStatusCounts>;
}

/** Whether the transport could actually deliver, shown next to the settings. */
export interface AdminEmailTransportStatus {
  /** ZEPTOMAIL_ENABLED. */
  enabled: boolean;
  /** Token and sender address are both present. */
  configured: boolean;
  /** What is missing, when it is not configured. */
  problem: string | null;
  from_address: string;
  from_name: string;
  dry_run: boolean;
  /** EMAIL_MARKETING_ENABLED — whether the schedule is registered at all. */
  cron_enabled: boolean;
  cron_expression: string;
  cron_timezone: string;
}

// --- contact inquiries -----------------------------------------------------

export type AdminContactStatusFilter = 'all' | 'new' | 'read';

export interface AdminContactListQuery extends DateRangeFilter {
  /** Matched against name, email and message body. */
  search?: string;
  status?: AdminContactStatusFilter;
  /** A topic key from the funnel's dropdown, or 'all'. */
  topic?: string;
  page: number;
  page_size: number;
}
