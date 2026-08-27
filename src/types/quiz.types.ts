export interface UserAnswerInput {
  question_id: string;
  selected_option_id: string;
  time_spent_seconds?: number;
}

export interface CategoryScores {
  logical: number;
  spatial: number;
  numerical: number;
  memory: number;
  [key: string]: number;
}

export interface QuizSubmitPayload {
  email: string;
  iq_score: number;
  category_scores?: CategoryScores;
  duration_seconds?: number;
  language?: string;
  landing_url_details?: {
    landing_url?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    referrer?: string;
  };
}
