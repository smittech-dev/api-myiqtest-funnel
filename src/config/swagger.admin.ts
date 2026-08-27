/**
 * OpenAPI fragments for the /admin endpoints, kept separate from
 * swagger.config.ts so the funnel spec stays readable. Merged into the main
 * document by swagger.config.ts.
 */

export const adminSchemas = {
  AdminUserProfile: {
    type: 'object',
    properties: {
      id: { type: 'string', example: '1' },
      name: { type: 'string', example: 'Jane Doe' },
      email: { type: 'string', format: 'email', example: 'admin@iqfunnel.com' },
      role: { type: 'string', example: 'admin' },
      status: { type: 'string', example: 'active' }
    }
  },
  AdminLoginResult: {
    type: 'object',
    properties: {
      token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
      token_type: { type: 'string', example: 'Bearer' },
      expires_in: {
        type: 'integer',
        description: 'Seconds until the token expires (60 days by default).',
        example: 5184000
      },
      user: { $ref: '#/components/schemas/AdminUserProfile' }
    }
  },
  AdminDashboardStats: {
    type: 'object',
    description:
      'All four counts are cohorted on the quiz submission date, so a conversion rate taken across them is meaningful.',
    properties: {
      total_quiz_submitted: { type: 'integer', example: 84 },
      total_first_sale: { type: 'integer', example: 40 },
      total_cross_sale: { type: 'integer', example: 16 },
      total_active_subscription: { type: 'integer', example: 13 }
    }
  },
  EmailMarketingStep: {
    type: 'object',
    description:
      'One rung of the sequence. `key` is permanent — every send-log row references it — while label, delay, code and template are freely editable.',
    properties: {
      key: { type: 'string', example: 'step_24h' },
      label: { type: 'string', example: '24 hours — 20% off' },
      enabled: { type: 'boolean', example: true },
      delay_hours: {
        type: 'number',
        description: 'Hours after quiz submission. Fractional values allowed, for testing.',
        example: 24
      },
      discount_code: {
        type: 'string',
        description: 'A code from data/discount-codes.json. Empty means no discount.',
        example: 'K75QSQC'
      },
      template_id: { type: 'string', example: 'marketing_reminder_day1' }
    }
  },
  EmailMarketingSettings: {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean',
        description:
          'The sequence own switch, separate from EMAIL_MARKETING_ENABLED — that one decides whether the cron is registered at all, this one whether a registered run actually sends.',
        example: true
      },
      batch_size: { type: 'integer', minimum: 1, maximum: 500, example: 50 },
      max_attempts: { type: 'integer', minimum: 1, maximum: 10, example: 3 },
      max_age_hours: {
        type: 'number',
        description:
          'Quizzes older than this are never contacted — the guard that stops enabling the feature from emailing every historic unconverted lead.',
        example: 240
      },
      steps: { type: 'array', items: { $ref: '#/components/schemas/EmailMarketingStep' } }
    }
  },
  EmailTemplateOption: {
    type: 'object',
    description: 'One entry of the template master (src/emails/registry.ts).',
    properties: {
      id: { type: 'string', example: 'marketing_reminder_day1' },
      name: { type: 'string', example: 'Day 1 — your report is waiting (20% off)' },
      description: { type: 'string' },
      category: {
        type: 'string',
        enum: ['marketing', 'transactional'],
        description:
          'Marketing designs run the abandoned-checkout ladder; transactional ones follow a purchase. The step picker offers marketing only; test-send offers both.',
        example: 'marketing'
      },
      params: {
        type: 'array',
        items: { type: 'string' },
        description: 'The dynamic parameters this design consumes.',
        example: [
          'first_name',
          'honorific_name',
          'iq_score',
          'discount_code',
          'discount_percent',
          'cta_url',
          'site_url'
        ]
      },
      subject: {
        type: 'object',
        properties: { ja: { type: 'string' }, en: { type: 'string' } }
      },
      hosted_in_zeptomail: {
        type: 'boolean',
        description:
          'True when ZEPTOMAIL_TEMPLATE_<ID> is set, meaning ZeptoMail renders the design and editing the copy in this repo has no effect.',
        example: false
      }
    }
  },
  EmailMarketingStatusCounts: {
    type: 'object',
    properties: {
      sent: { type: 'integer', example: 312 },
      failed: { type: 'integer', example: 4 },
      skipped: { type: 'integer', example: 58 },
      pending: { type: 'integer', example: 0 }
    }
  },
  EmailMarketingLogItem: {
    type: 'object',
    properties: {
      id: { type: 'string', example: '4412' },
      customer_id: { type: 'string', example: '5068' },
      customer_quiz_result_id: { type: 'string', nullable: true, example: '10068' },
      email: { type: 'string', format: 'email' },
      step_key: { type: 'string', example: 'step_48h' },
      template_id: { type: 'string', example: 'marketing_reminder_day2' },
      template_name: {
        type: 'string',
        description: 'Resolved from the template master for display; the row stores only the id.'
      },
      discount_code: { type: 'string', nullable: true, example: 'K75QSQC' },
      language: { type: 'string', example: 'ja' },
      status: { type: 'string', enum: ['pending', 'sent', 'failed', 'skipped'], example: 'sent' },
      provider_message_id: {
        type: 'string',
        nullable: true,
        description: 'ZeptoMail request_id, for tracing one delivery in their console.'
      },
      error_message: { type: 'string', nullable: true },
      skip_reason: { type: 'string', nullable: true, example: 'superseded by step_72h' },
      attempts: { type: 'integer', example: 1 },
      sent_at: { type: 'string', format: 'date-time', nullable: true },
      created_at: { type: 'string', format: 'date-time' }
    }
  },
  EmailMarketingRunResult: {
    type: 'object',
    properties: {
      candidates: { type: 'integer', example: 37 },
      sent: { type: 'integer', example: 31 },
      failed: { type: 'integer', example: 0 },
      superseded: {
        type: 'integer',
        description: 'Steps retired without sending because a later rung was already due.',
        example: 6
      },
      nothing_due: { type: 'integer', example: 6 },
      duration_ms: { type: 'integer', example: 4210 }
    }
  },

  AdminQuizListItem: {
    type: 'object',
    properties: {
      id: { type: 'string', example: '10068' },
      customer_id: { type: 'string', nullable: true, example: '5068' },
      email: { type: 'string', format: 'email' },
      first_name: { type: 'string', nullable: true },
      last_name: { type: 'string', nullable: true },
      age: { type: 'string', nullable: true },
      gender: { type: 'string', nullable: true },
      iq_score: { type: 'integer', nullable: true, example: 118 },
      duration_seconds: { type: 'integer', nullable: true, example: 755 },
      language: { type: 'string', example: 'ja' },
      country_code: { type: 'string', example: 'JP' },
      landing_url_details: { type: 'object', nullable: true },
      created_at: { type: 'string', format: 'date-time' },
      revenue: {
        type: 'string',
        description: 'Sum of succeeded transactions, in the quiz currency.',
        example: '4460.00'
      },
      has_first_sale: { type: 'boolean' },
      has_cross_sale: { type: 'boolean' },
      first_sale_amount: { type: 'string', nullable: true, example: '2980.00' },
      cross_sale_amount: { type: 'string', nullable: true, example: '1480.00' },
      subscription_status: { type: 'string', nullable: true, example: 'active' }
    }
  },
  AdminQuizListResult: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: { $ref: '#/components/schemas/AdminQuizListItem' }
      },
      total: { type: 'integer', example: 84 },
      page: { type: 'integer', example: 1 },
      page_size: { type: 'integer', example: 10 },
      total_pages: { type: 'integer', example: 9 }
    }
  },
  AdminQuizDetail: {
    type: 'object',
    properties: {
      quiz: { type: 'object', description: 'The full customer_quiz_results row.' },
      customer: {
        type: 'object',
        nullable: true,
        description: 'Customer account, without the password hash.',
        properties: {
          id: { type: 'string' },
          email: { type: 'string', format: 'email' },
          email_verified: { type: 'boolean' },
          status: { type: 'string' },
          stripe_customer_id: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' }
        }
      },
      transactions: {
        type: 'array',
        description: 'Every payment attempt for this quiz, newest first.',
        items: { type: 'object' }
      },
      subscriptions: {
        type: 'array',
        description: 'Every subscription started from this quiz, newest first.',
        items: { type: 'object' }
      }
    }
  }
};

const DATE_PARAM = (name: 'from' | 'to') => ({
  in: 'query',
  name,
  required: false,
  schema: { type: 'string', example: '2026-08-01' },
  description:
    'YYYY-MM-DD (widened to the whole UTC day) or a full ISO timestamp. Omit for all time.'
});

const adminAuthPaths = {
  '/admin/auth/login': {
    post: {
      tags: ['Admin'],
      summary: 'Admin sign in',
      description:
        'Exchanges admin credentials for a 60-day bearer token. This is the only admin route reachable without a token. There is no registration or password-reset endpoint by design — provision accounts with `npm run create:admin`.',
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['email', 'password'],
              properties: {
                email: { type: 'string', format: 'email', example: 'admin@iqfunnel.com' },
                password: { type: 'string', example: 'super-secret' }
              }
            }
          }
        }
      },
      responses: {
        200: {
          description: 'Signed in.',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/SuccessEnvelope' },
                  {
                    type: 'object',
                    properties: { data: { $ref: '#/components/schemas/AdminLoginResult' } }
                  }
                ]
              }
            }
          }
        },
        400: { $ref: '#/components/responses/ValidationError' },
        401: { description: 'Invalid email or password.' },
        403: { description: 'Admin account is not active.' }
      }
    }
  },

  '/admin/auth/me': {
    get: {
      tags: ['Admin'],
      summary: 'Current admin profile',
      description: 'Lets the panel restore a session on reload without re-prompting.',
      security: [{ AdminAuth: [] }],
      responses: {
        200: {
          description: 'The signed-in admin.',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/SuccessEnvelope' },
                  {
                    type: 'object',
                    properties: { data: { $ref: '#/components/schemas/AdminUserProfile' } }
                  }
                ]
              }
            }
          }
        },
        401: { $ref: '#/components/responses/Unauthorized' }
      }
    }
  },

  '/admin/auth/logout': {
    post: {
      tags: ['Admin'],
      summary: 'Admin sign out',
      description:
        'Tokens are stateless, so this only tells the client to discard its copy. Real revocation is setting the admin users.status to something other than active.',
      security: [{ AdminAuth: [] }],
      responses: {
        200: { description: 'Discard the token client-side.' },
        401: { $ref: '#/components/responses/Unauthorized' }
      }
    }
  }
};

const adminDataPaths = {
  '/admin/dashboard/stats': {
    get: {
      tags: ['Admin'],
      summary: 'Dashboard KPIs',
      description:
        'The four dashboard counters, filtered by date range. Every count is cohorted on the quiz submission date — "of the quizzes submitted in this window, how many produced a first sale, a cross sale, an active subscription" — so the numbers stay comparable to each other.',
      security: [{ AdminAuth: [] }],
      parameters: [DATE_PARAM('from'), DATE_PARAM('to')],
      responses: {
        200: {
          description: 'KPI counts for the window.',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/SuccessEnvelope' },
                  {
                    type: 'object',
                    properties: { data: { $ref: '#/components/schemas/AdminDashboardStats' } }
                  }
                ]
              }
            }
          }
        },
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' }
      }
    }
  },

  '/admin/quiz-submissions': {
    get: {
      tags: ['Admin'],
      summary: 'List quiz submissions',
      description:
        'Paginated submission list for the admin Quiz page, newest first. Search matches an exact quiz id or a partial, case-insensitive customer email.',
      security: [{ AdminAuth: [] }],
      parameters: [
        {
          in: 'query',
          name: 'search',
          schema: { type: 'string', maxLength: 255 },
          description: 'Exact quiz id (numeric) or partial customer email.'
        },
        {
          in: 'query',
          name: 'status',
          schema: {
            type: 'string',
            enum: ['all', 'first_sale', 'cross_sale', 'subscription', 'no_purchase'],
            default: 'all'
          },
          description:
            'first_sale / cross_sale match a succeeded charge of that type; subscription matches an active plan; no_purchase matches quizzes with no succeeded first sale.'
        },
        {
          in: 'query',
          name: 'language',
          schema: { type: 'string', enum: ['all', 'ja', 'en'], default: 'all' }
        },
        DATE_PARAM('from'),
        DATE_PARAM('to'),
        {
          in: 'query',
          name: 'page',
          schema: { type: 'integer', minimum: 1, default: 1 }
        },
        {
          in: 'query',
          name: 'page_size',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 }
        }
      ],
      responses: {
        200: {
          description: 'One page of submissions.',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/SuccessEnvelope' },
                  {
                    type: 'object',
                    properties: { data: { $ref: '#/components/schemas/AdminQuizListResult' } }
                  }
                ]
              }
            }
          }
        },
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' }
      }
    }
  },

  '/admin/quiz-submissions/{id}': {
    get: {
      tags: ['Admin'],
      summary: 'Quiz submission detail',
      description:
        'The full record behind one submission: the quiz row, the linked customer account, every payment attempt, and every subscription it produced. Takes the raw numeric quiz id, not the encrypted funnel id.',
      security: [{ AdminAuth: [] }],
      parameters: [
        {
          in: 'path',
          name: 'id',
          required: true,
          schema: { type: 'string', pattern: '^\d+$' },
          example: '10068'
        }
      ],
      responses: {
        200: {
          description: 'The submission and everything attached to it.',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/SuccessEnvelope' },
                  {
                    type: 'object',
                    properties: { data: { $ref: '#/components/schemas/AdminQuizDetail' } }
                  }
                ]
              }
            }
          }
        },
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' }
      }
    }
  }
};

const adminCurrencyPaths = {
  '/admin/currency-rates/sync': {
    post: {
      tags: ['Admin'],
      summary: 'Refresh exchange rates now',
      description:
        'Runs the same refresh as the twelve-hourly cron — the same code path, ' +
        'sharing the same overlap guard — so an operator can update rates on ' +
        'demand instead of waiting for the next tick. Takes no body and no ' +
        'parameters: every currency the provider returns is stored, so there is ' +
        'nothing for a caller to choose. ' +
        'It ignores CURRENCY_SYNC_ENABLED, which governs only the schedule — turning ' +
        'the schedule off is not a reason to refuse a refresh someone explicitly ' +
        'asked for. EXCHANGERATES_API_KEY is still required. Rates are stored with ' +
        'GBP as the base: rate_to_gbp is how many units of a currency equal one GBP, ' +
        'so GBP itself is always 1. A currency the provider returned no usable rate ' +
        'for is listed under skipped and keeps its previously stored value rather ' +
        'than being zeroed.',
      security: [{ AdminAuth: [] }],
      responses: {
        200: {
          description: 'Rates refreshed. `rates` is the full stored set after the update.',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/SuccessEnvelope' },
                  {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          synced: {
                            type: 'array',
                            items: { type: 'string' },
                            example: ['GBP', 'JPY']
                          },
                          skipped: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'No usable rate returned; the stored value was left alone.',
                            example: []
                          },
                          source_base: {
                            type: 'string',
                            description:
                              "The base the provider actually answered in. The free plan serves " +
                              "EUR quotes only, which is why the sync requests EUR and rebases " +
                              "them on GBP locally before storing.",
                            example: 'EUR'
                          },
                          fetched_at: { type: 'string', format: 'date-time' },
                          duration_ms: { type: 'integer', example: 412 },
                          rates: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                currency_code: { type: 'string', example: 'JPY' },
                                rate_to_gbp: { type: 'number', example: 216.804321 },
                                updated_at: { type: 'string', format: 'date-time' }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                ]
              }
            }
          }
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        409: {
          description:
            'A sync is already running — scheduled or manual. Not a fault; retry shortly.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
        },
        500: {
          description: 'EXCHANGERATES_API_KEY is not configured.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
        },
        502: {
          description: 'The exchange rate provider was unreachable, timed out, or returned an error.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
        }
      }
    }
  }
};

const adminEmailMarketingPaths = {
  '/admin/email-marketing/config': {
    get: {
      tags: ['Admin'],
      summary: 'Email marketing settings and the catalogues to edit them',
      description:
        'Returns the sequence settings together with everything the editor needs: the template master, the discount codes, the transport status and current send counts. Serving them in one response is deliberate — the panel therefore cannot offer a template or code that the PUT would reject.',
      security: [{ AdminAuth: [] }],
      responses: {
        200: {
          description: 'Settings plus catalogues.',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/SuccessEnvelope' },
                  {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          settings: { $ref: '#/components/schemas/EmailMarketingSettings' },
                          templates: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/EmailTemplateOption' }
                          },
                          discount_codes: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                code: { type: 'string', example: 'K75QSQC' },
                                discount: { type: 'integer', example: 20 }
                              }
                            }
                          },
                          transport: {
                            type: 'object',
                            description:
                              'Whether mail could actually be delivered right now, and what is missing if not.',
                            properties: {
                              enabled: { type: 'boolean' },
                              configured: { type: 'boolean' },
                              problem: { type: 'string', nullable: true },
                              from_address: { type: 'string' },
                              from_name: { type: 'string' },
                              dry_run: { type: 'boolean' },
                              cron_enabled: { type: 'boolean' },
                              cron_expression: { type: 'string', example: '*/5 * * * *' },
                              cron_timezone: { type: 'string', example: 'UTC' }
                            }
                          },
                          stats: {
                            type: 'object',
                            properties: {
                              totals: { $ref: '#/components/schemas/EmailMarketingStatusCounts' },
                              by_step: {
                                type: 'object',
                                additionalProperties: {
                                  $ref: '#/components/schemas/EmailMarketingStatusCounts'
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                ]
              }
            }
          }
        },
        401: { $ref: '#/components/responses/Unauthorized' }
      }
    },

    put: {
      tags: ['Admin'],
      summary: 'Save email marketing settings',
      description:
        'Replaces the whole settings object — a step delay only makes sense against the other steps delays, so there is nothing sensible to patch a field at a time. Written to email_marketing_settings and email_marketing_steps in one transaction, and picked up by the next run without a restart.\n\nValidation rejects: an unknown template id, a discount code missing from data/discount-codes.json, duplicate step keys, two enabled steps sharing a delay, and an enabled step whose template writes the discount into its copy but has no code selected.',
      security: [{ AdminAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/EmailMarketingSettings' } }
        }
      },
      responses: {
        200: {
          description: 'Settings saved.',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/SuccessEnvelope' },
                  {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          settings: { $ref: '#/components/schemas/EmailMarketingSettings' }
                        }
                      }
                    }
                  }
                ]
              }
            }
          }
        },
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' }
      }
    }
  },

  '/admin/email-marketing/logs': {
    get: {
      tags: ['Admin'],
      summary: 'Marketing send history',
      description:
        'Paginated tracking log, newest first. One row per (customer, step) — the same rows that stop a customer being sent the same step twice.',
      security: [{ AdminAuth: [] }],
      parameters: [
        {
          in: 'query',
          name: 'step_key',
          schema: { type: 'string', maxLength: 50 },
          description: 'A step key, or "all".'
        },
        {
          in: 'query',
          name: 'status',
          schema: { type: 'string', enum: ['all', 'pending', 'sent', 'failed', 'skipped'] }
        },
        {
          in: 'query',
          name: 'search',
          schema: { type: 'string', maxLength: 255 },
          description: 'Partial, case-insensitive recipient address.'
        },
        DATE_PARAM('from'),
        DATE_PARAM('to'),
        { in: 'query', name: 'page', schema: { type: 'integer', minimum: 1, default: 1 } },
        {
          in: 'query',
          name: 'page_size',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
        }
      ],
      responses: {
        200: {
          description: 'One page of send history.',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/SuccessEnvelope' },
                  {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          items: {
                            type: 'array',
                            items: { $ref: '#/components/schemas/EmailMarketingLogItem' }
                          },
                          total: { type: 'integer' },
                          page: { type: 'integer' },
                          page_size: { type: 'integer' },
                          total_pages: { type: 'integer' }
                        }
                      }
                    }
                  }
                ]
              }
            }
          }
        },
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' }
      }
    }
  },

  '/admin/email-marketing/stats': {
    get: {
      tags: ['Admin'],
      summary: 'Marketing send counts',
      description: 'Sent / failed / skipped / pending counts, in total and per step.',
      security: [{ AdminAuth: [] }],
      parameters: [DATE_PARAM('from'), DATE_PARAM('to')],
      responses: {
        200: {
          description: 'Counts for the window.',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/SuccessEnvelope' },
                  {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          totals: { $ref: '#/components/schemas/EmailMarketingStatusCounts' },
                          by_step: {
                            type: 'object',
                            additionalProperties: {
                              $ref: '#/components/schemas/EmailMarketingStatusCounts'
                            }
                          }
                        }
                      }
                    }
                  }
                ]
              }
            }
          }
        },
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' }
      }
    }
  },

  '/admin/email-marketing/run': {
    post: {
      tags: ['Admin'],
      summary: 'Run the sequence now',
      description:
        'Runs exactly what the five-minute cron runs — the same function, sharing the same overlap guard. It ignores EMAIL_MARKETING_ENABLED, which governs the schedule: an operator asking for a run has asked for a run. The sequence own enabled flag is still honoured, because that one means "do not send to customers".',
      security: [{ AdminAuth: [] }],
      responses: {
        200: {
          description: 'What the run did.',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/SuccessEnvelope' },
                  {
                    type: 'object',
                    properties: {
                      data: { $ref: '#/components/schemas/EmailMarketingRunResult' }
                    }
                  }
                ]
              }
            }
          }
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        409: {
          description: 'A run is already in progress — scheduled or manual. Retry shortly.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
        }
      }
    }
  },

  '/admin/email-marketing/test-send': {
    post: {
      tags: ['Admin'],
      summary: 'Send a test email',
      description:
        'Delivers any template — marketing or transactional — to a chosen address with sample data. Writes no tracking row, so nobody loses their place in the sequence. A discount code is always attached — the one given, or the smallest real one — because these designs write the discount into their copy.',
      security: [{ AdminAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['template_id', 'to'],
              properties: {
                template_id: { type: 'string', example: 'marketing_reminder_day3' },
                to: { type: 'string', format: 'email' },
                language: { type: 'string', enum: ['ja', 'en'], default: 'ja' },
                discount_code: { type: 'string', example: 'K75QSQC' }
              }
            }
          }
        }
      },
      responses: {
        200: {
          description: 'The provider accepted the message.',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/SuccessEnvelope' },
                  {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          subject: { type: 'string' },
                          message_id: { type: 'string', nullable: true }
                        }
                      }
                    }
                  }
                ]
              }
            }
          }
        },
        400: { $ref: '#/components/responses/ValidationError' },
        401: { $ref: '#/components/responses/Unauthorized' },
        409: {
          description: 'Email sending is disabled (ZEPTOMAIL_ENABLED=false).',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
        },
        500: {
          description: 'ZEPTOMAIL_TOKEN or ZEPTOMAIL_FROM_ADDRESS is not configured.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
        },
        502: {
          description: 'ZeptoMail rejected the message or was unreachable.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
        }
      }
    }
  }
};

export const adminPaths = {
  ...adminAuthPaths,
  ...adminDataPaths,
  ...adminCurrencyPaths,
  ...adminEmailMarketingPaths
};
