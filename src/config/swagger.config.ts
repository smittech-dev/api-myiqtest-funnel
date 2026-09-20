import { config } from './env.config.js';
import { adminPaths, adminSchemas } from './swagger.admin.js';

/**
 * OpenAPI 3.0 specification for the IQ Funnel API.
 * Served by swagger-ui-express at GET /docs
 */
export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'IQ Funnel API',
    version: '1.0.0',
    description: [
      'Backend API for the Japanese IQ funnel.',
      '',
      '**Funnel flow:**',
      '1. `POST /questions/submit` — submit the score, receive an encrypted `quiz_id`.',
      '2. `POST /payment/first-sale/create-payment-intent` — pay for the certificate + report.',
      '3. `POST /payment/cross-sale/create-payment-intent` — optional career report upsell.',
      '4. `PUT /customer/update` — capture name and age for the certificate.',
      '5. `GET /questions/results` — redirect guard; returns the page the user belongs on.',
      '6. `GET /questions/report` — thank-you payload; customer, quiz, report entitlements, redirect.',
      '',
      'Every `quiz_id` in this API is the **encrypted** id returned by `/questions/submit`.'
    ].join('\n')
  },
  // Placeholder only. The list actually served is rebuilt per request by
  // `swaggerSpecFor` below, so that "Try it out" targets the host the docs were
  // loaded from. This static value is what anything importing the spec directly
  // (codegen, a schema dump) sees.
  servers: [{ url: config.appUrl, description: 'Configured APP_URL' }],
  tags: [
    { name: 'Health', description: 'Service liveness' },
    { name: 'Quiz', description: 'Quiz submission and funnel redirect guard' },
    { name: 'Pricing', description: 'Funnel prices and discounts' },
    { name: 'Payment', description: 'Stripe payment intents and webhook' },
    { name: 'Customer', description: 'Customer demographic details' },
    { name: 'Admin', description: 'Admin panel: sign in, dashboard KPIs, quiz submissions' }
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description:
          'Required only when API_KEY is set in the environment. Leave blank in local development if API_KEY is empty.'
      },
      AdminAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Bearer token from POST /admin/auth/login, valid for 60 days. Guards every /admin route. Admin routes do NOT require the x-api-key header.'
      }
    },
    schemas: {
      ...adminSchemas,

      SuccessEnvelope: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' },
          data: { type: 'object', nullable: true }
        }
      },
      ErrorEnvelope: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              message: { type: 'string', example: 'Quiz result not found' },
              details: {
                type: 'array',
                nullable: true,
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'string', example: 'email' },
                    message: { type: 'string', example: 'Invalid email' }
                  }
                }
              }
            }
          }
        }
      },
      CategoryScores: {
        type: 'object',
        description:
          "The instrument's three subtests, by key: `visual` (Visual Reasoning), `insight` " +
          '(Visual Insight) and `numerical` (Numerical Reasoning). Accepted as a free-form ' +
          'map of numbers and stored verbatim, so the item bank can gain or rename a subtest ' +
          'without breaking submits already in the wild.',
        additionalProperties: { type: 'number' },
        example: { visual: 121, insight: 130, numerical: 118 }
      },
      QuizReportResponse: {
        allOf: [
          { $ref: '#/components/schemas/SuccessEnvelope' },
          {
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  redirect_url: {
                    type: 'string',
                    enum: [
                      'CHECKOUT_PAGE',
                      'CROSS_SELL_PAGE',
                      'CUSTOMER_DETAILS_PAGE',
                      'THANK_YOU_PAGE'
                    ],
                    example: 'THANK_YOU_PAGE'
                  },
                  quiz: {
                    type: 'object',
                    properties: {
                      quiz_id: {
                        type: 'string',
                        description: 'Re-encrypted on every read, so it differs each call. Do not compare for equality.'
                      },
                      iq_score: { type: 'integer', nullable: true, example: 128 },
                      category_scores: {
                        allOf: [{ $ref: '#/components/schemas/CategoryScores' }],
                        nullable: true
                      },
                      language: { type: 'string', example: 'ja' },
                      duration_seconds: { type: 'integer', nullable: true, example: 640 },
                      completed_at: { type: 'string', format: 'date-time' }
                    }
                  },
                  customer: {
                    type: 'object',
                    properties: {
                      email: { type: 'string', example: 'customer@example.com' },
                      first_name: { type: 'string', nullable: true, example: '太郎' },
                      last_name: { type: 'string', nullable: true, example: '山田' },
                      age: { type: 'string', nullable: true, example: '30' },
                      gender: { type: 'string', nullable: true, example: null }
                    }
                  },
                  report: {
                    type: 'object',
                    description:
                      'Which of the two reports this customer has paid for. Derived from ' +
                      'succeeded transactions only — a pending or failed payment reads as false.',
                    properties: {
                      first_sale_paid: {
                        type: 'boolean',
                        example: true,
                        description: 'Certificate + detailed IQ report.'
                      },
                      cross_sale_paid: {
                        type: 'boolean',
                        example: false,
                        description: 'Career aptitude & personality report.'
                      }
                    }
                  }
                }
              }
            }
          }
        ]
      },
      LandingUrlDetails: {
        type: 'object',
        properties: {
          landing_url: { type: 'string', example: 'https://example.com/lp/a' },
          utm_source: { type: 'string', example: 'google' },
          utm_medium: { type: 'string', example: 'cpc' },
          utm_campaign: { type: 'string', example: 'jp_iq_2026' },
          referrer: { type: 'string', example: 'https://referrer.example.com/' }
        }
      },
      QuizSubmitRequest: {
        type: 'object',
        required: ['email', 'iq_score'],
        properties: {
          email: { type: 'string', format: 'email', example: 'taro@example.com' },
          iq_score: {
            type: 'integer',
            minimum: 40,
            maximum: 200,
            example: 128,
            description: 'Pre-calculated by the frontend.'
          },
          category_scores: { $ref: '#/components/schemas/CategoryScores' },
          duration_seconds: { type: 'integer', minimum: 0, example: 640 },
          language: { type: 'string', example: 'ja', description: "'ja' or 'en'; anything else falls back to 'ja'." },
          landing_url_details: { $ref: '#/components/schemas/LandingUrlDetails' }
        }
      },
      QuizSubmitResponse: {
        allOf: [
          { $ref: '#/components/schemas/SuccessEnvelope' },
          {
            type: 'object',
            properties: {
              message: { type: 'string', example: 'Quiz submitted successfully' },
              data: {
                type: 'object',
                properties: {
                  quiz_id: {
                    type: 'string',
                    example: 'a1b2c3d4e5f6',
                    description: 'Encrypted quiz result id. Pass this to every downstream endpoint.'
                  }
                }
              }
            }
          }
        ]
      },
      QuizResultsResponse: {
        allOf: [
          { $ref: '#/components/schemas/SuccessEnvelope' },
          {
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  redirect_url: {
                    type: 'string',
                    enum: ['CHECKOUT_PAGE', 'CROSS_SELL_PAGE', 'CUSTOMER_DETAILS_PAGE', 'THANK_YOU_PAGE'],
                    description:
                      'Derived from succeeded payments and saved demographics, in this order: no first sale → CHECKOUT_PAGE; ' +
                      'name saved → THANK_YOU_PAGE (this wins, so declining the upsell is not a dead end); ' +
                      'no cross sale → CROSS_SELL_PAGE; otherwise CUSTOMER_DETAILS_PAGE.'
                  },
                  quiz: {
                    type: 'object',
                    properties: {
                      quiz_id: { type: 'string', example: 'a1b2c3d4e5f6' },
                      iq_score: { type: 'integer', nullable: true, example: 128 },
                      category_scores: { type: 'object', nullable: true },
                      language: { type: 'string', example: 'ja' },
                      duration_seconds: { type: 'integer', nullable: true, example: 640 }
                    }
                  },
                  customer: {
                    type: 'object',
                    properties: {
                      email: { type: 'string', example: 'taro@example.com' },
                      first_name: { type: 'string', nullable: true, example: '太郎' },
                      last_name: { type: 'string', nullable: true, example: '山田' },
                      age: { type: 'string', nullable: true, example: '30' }
                    }
                  }
                }
              }
            }
          }
        ]
      },
      PaymentIntentRequest: {
        type: 'object',
        required: ['quiz_id'],
        properties: {
          quiz_id: {
            type: 'string',
            example: 'a1b2c3d4e5f6',
            description: 'Encrypted quiz id from /questions/submit.'
          },
          language: {
            type: 'string',
            enum: ['ja', 'en'],
            example: 'ja',
            description: "Optional. Selects the price and currency. Defaults to the quiz result's saved language."
          }
        }
      },
      FirstSaleIntentRequest: {
        type: 'object',
        required: ['quiz_id'],
        properties: {
          quiz_id: {
            type: 'string',
            example: 'a1b2c3d4e5f6',
            description: 'Encrypted quiz id from /questions/submit.'
          },
          language: {
            type: 'string',
            enum: ['ja', 'en'],
            example: 'ja',
            description: "Optional. Selects the price and currency. Defaults to the quiz result's saved language."
          },
          price_dis: {
            type: 'string',
            example: 'K75QSQC',
            description:
              'Optional discount code, resolved server-side against data/discount-codes.json. Accepts a ' +
              'plain code (`K75QSQC`) or one personalised with the first two letters of the email plus an ' +
              'underscore (`pu_K75QSQC`). Revalidated here, so the PaymentIntent is created for the ' +
              'discounted amount — this is what actually gets charged.'
          }
        }
      },
      PaymentIntentResponse: {
        allOf: [
          { $ref: '#/components/schemas/SuccessEnvelope' },
          {
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  client_secret: { type: 'string', example: 'pi_3Q..._secret_...' },
                  payment_intent_id: { type: 'string', example: 'pi_3Q...' },
                  amount: {
                    type: 'number',
                    example: 2980,
                    description: 'Human-readable amount in the charged currency (JPY 2980 / GBP 19.99).'
                  },
                  currency: { type: 'string', example: 'JPY', enum: ['JPY', 'GBP'] }
                }
              }
            }
          }
        ]
      },
      PricedProduct: {
        type: 'object',
        properties: {
          title: { type: 'string', example: '公式IQ認定証＋詳細診断レポート' },
          currency: { type: 'string', enum: ['JPY', 'GBP'], example: 'JPY' },
          original_price: { type: 'number', example: 2980, description: 'List price before any discount.' },
          price: { type: 'number', example: 2384, description: 'What the customer actually pays.' },
          discount_percentage: { type: 'number', example: 20 },
          stripe_amount: { type: 'integer', example: 2384, description: 'Smallest currency unit sent to Stripe.' }
        }
      },
      PriceResponse: {
        allOf: [
          { $ref: '#/components/schemas/SuccessEnvelope' },
          {
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  language: { type: 'string', enum: ['ja', 'en'], example: 'ja' },
                  currency: { type: 'string', enum: ['JPY', 'GBP'], example: 'JPY' },
                  discount_percentage: { type: 'number', example: 20, description: 'Percentage the resolved code was worth.' },
                  discount_code: {
                    type: 'string',
                    nullable: true,
                    example: 'K75QSQC',
                    description: 'Canonical code that matched, or null when no discount applied.'
                  },
                  first_sale: { $ref: '#/components/schemas/PricedProduct' },
                  cross_sale: { $ref: '#/components/schemas/PricedProduct' },
                  subscription: {
                    allOf: [
                      { $ref: '#/components/schemas/PricedProduct' },
                      { type: 'object', properties: { price_id: { type: 'string', example: 'price_1Q...' } } }
                    ]
                  }
                }
              }
            }
          }
        ]
      },
      FirstSaleConfirmRequest: {
        type: 'object',
        required: ['quiz_id', 'payment_intent_id'],
        properties: {
          quiz_id: {
            type: 'string',
            example: 'a1b2c3d4e5f6',
            description: 'Encrypted quiz id from /questions/submit.'
          },
          payment_intent_id: {
            type: 'string',
            example: 'pi_3Q...',
            description: 'The PaymentIntent the browser just confirmed with Stripe.js.'
          }
        }
      },
      FirstSaleConfirmResponse: {
        allOf: [
          { $ref: '#/components/schemas/SuccessEnvelope' },
          {
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  status: {
                    type: 'string',
                    example: 'succeeded',
                    description: 'Raw Stripe PaymentIntent status, read back from Stripe (not taken from the client).'
                  },
                  payment_intent_id: { type: 'string', example: 'pi_3Q...' },
                  paid: { type: 'boolean', example: true, description: 'True only when status is succeeded.' },
                  requires_action: { type: 'boolean', example: false },
                  client_secret: { type: 'string', nullable: true, example: 'pi_3Q..._secret_...' },
                  amount: { type: 'number', example: 2980 },
                  currency: { type: 'string', example: 'JPY', enum: ['JPY', 'GBP'] },
                  redirect_url: {
                    type: 'string',
                    enum: ['CHECKOUT_PAGE', 'CROSS_SELL_PAGE', 'CUSTOMER_DETAILS_PAGE', 'THANK_YOU_PAGE'],
                    example: 'CROSS_SELL_PAGE',
                    description: 'Funnel position recomputed after settling — send the customer straight here.'
                  },
                  subscription: {
                    type: 'object',
                    description:
                      'Outcome of starting the recurring plan on the same saved card. Best-effort: a failure here ' +
                      'never fails the request, because the first sale has already been charged.',
                    properties: {
                      created: { type: 'boolean', example: true },
                      subscription_id: { type: 'string', nullable: true, example: 'sub_1Q...' },
                      status: {
                        type: 'string',
                        nullable: true,
                        example: 'active',
                        description: 'Stripe subscription status (active, incomplete, trialing, …).'
                      },
                      reason: {
                        type: 'string',
                        nullable: true,
                        example: 'subscriptions disabled (SUBSCRIPTION_ENABLED=false)',
                        description: 'Why no subscription was started, when created is false.'
                      }
                    }
                  }
                }
              }
            }
          }
        ]
      },
      CrossSaleConfirmResponse: {
        allOf: [
          { $ref: '#/components/schemas/SuccessEnvelope' },
          {
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  status: {
                    type: 'string',
                    example: 'succeeded',
                    description: 'Raw Stripe PaymentIntent status.'
                  },
                  payment_intent_id: { type: 'string', example: 'pi_3Q...' },
                  paid: { type: 'boolean', example: true, description: 'True only when status is succeeded.' },
                  requires_action: {
                    type: 'boolean',
                    example: false,
                    description:
                      'True when the saved card demanded authentication. Note that an off-session failure leaves `status` at ' +
                      '`requires_payment_method`, not `requires_action` — recovering it means bringing the customer back ' +
                      'on-session and confirming against the returned `client_secret`.'
                  },
                  client_secret: { type: 'string', nullable: true, example: 'pi_3Q..._secret_...' },
                  amount: { type: 'number', example: 1480 },
                  currency: { type: 'string', example: 'JPY', enum: ['JPY', 'GBP'] },
                  redirect_url: {
                    type: 'string',
                    enum: ['CHECKOUT_PAGE', 'CROSS_SELL_PAGE', 'CUSTOMER_DETAILS_PAGE', 'THANK_YOU_PAGE'],
                    example: 'CUSTOMER_DETAILS_PAGE',
                    description: 'Funnel position recomputed after settling.'
                  }
                }
              }
            }
          }
        ]
      },
      CustomerUpdateRequest: {
        type: 'object',
        required: ['quiz_id', 'first_name', 'last_name', 'age'],
        properties: {
          quiz_id: { type: 'string', example: 'a1b2c3d4e5f6' },
          first_name: { type: 'string', example: '太郎' },
          last_name: { type: 'string', example: '山田' },
          age: { type: 'string', example: '30', description: 'Stored as a string.' }
        }
      }
    },
    responses: {
      ValidationError: {
        description: 'Request failed Zod validation, or the quiz_id could not be decrypted.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
      },
      NotFound: {
        description: 'Quiz result not found.',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
      },
      Unauthorized: {
        description: 'Missing or invalid x-api-key (only enforced when API_KEY is configured).',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
      }
    }
  },
  security: [{ ApiKeyAuth: [] }],
  paths: {
    ...adminPaths,

    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        security: [],
        responses: {
          200: {
            description: 'Service is up.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    timestamp: { type: 'string', format: 'date-time' }
                  }
                }
              }
            }
          }
        }
      }
    },

    '/questions/submit': {
      post: {
        tags: ['Quiz'],
        summary: 'Submit quiz score',
        description:
          'Creates (or reuses) an inactive customer by email, stores the quiz result, and returns the encrypted quiz_id used by every downstream endpoint.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/QuizSubmitRequest' },
              example: {
                email: 'taro@example.com',
                iq_score: 128,
                category_scores: { logical: 32, spatial: 28, numerical: 30, memory: 25 },
                duration_seconds: 640,
                language: 'ja',
                landing_url_details: {
                  landing_url: 'https://example.com/lp/a',
                  utm_source: 'google',
                  utm_medium: 'cpc',
                  utm_campaign: 'jp_iq_2026'
                }
              }
            }
          }
        },
        responses: {
          201: {
            description: 'Quiz submitted.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/QuizSubmitResponse' } } }
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' }
        }
      }
    },

    '/questions/results': {
      get: {
        tags: ['Quiz'],
        summary: 'Redirect guard — resolve which page the user belongs on',
        parameters: [
          {
            name: 'quiz_id',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            example: 'a1b2c3d4e5f6',
            description: 'Encrypted quiz id from /questions/submit.'
          }
        ],
        responses: {
          200: {
            description: 'Funnel position plus quiz and customer data.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/QuizResultsResponse' } } }
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' }
        }
      }
    },

    '/questions/report': {
      get: {
        tags: ['Quiz'],
        summary: 'Thank-you page payload — customer, quiz, report entitlements and funnel position',
        description:
          'One call for everything the thank-you page renders. `report` carries the two ' +
          'entitlement flags: `first_sale_paid` unlocks the certificate and detailed report, ' +
          '`cross_sale_paid` unlocks the career aptitude report. Both are derived from ' +
          'succeeded transactions, so a pending or failed payment reads as false. ' +
          '`redirect_url` is included so the page has no reason to call /questions/results ' +
          'as well.',
        parameters: [
          {
            name: 'quiz_id',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            example: 'a1b2c3d4e5f6',
            description: 'Encrypted quiz id from /questions/submit.'
          }
        ],
        responses: {
          200: {
            description: 'Customer, quiz, report entitlements and funnel position.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/QuizReportResponse' } } }
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' }
        }
      }
    },

    '/price': {
      get: {
        tags: ['Pricing'],
        summary: 'Funnel prices for a language, optionally discounted',
        description:
          'Returns the first sale, cross-sale and subscription prices. `price_dis` is a discount ' +
          'code that applies to the **first sale only** — that is the one the customer can pay at a ' +
          'reduced price. The upsell and subscription are charged at list price by their own ' +
          'endpoints, so they are reported at list price here. Codes come from data/discount-codes.json ' +
          'and may be personalised with the first two letters of the email plus an underscore ' +
          '(`pu_K75QSQC`); anything unrecognised is rejected with 400.',
        parameters: [
          {
            name: 'language',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['ja', 'en'], default: 'ja' },
            description: 'Also accepted as `lang`. Anything else falls back to ja.'
          },
          {
            name: 'price_dis',
            in: 'query',
            required: false,
            schema: { type: 'string', example: 'K75QSQC' },
            description: 'Discount code for the first sale. Plain (`K75QSQC`) or personalised (`pu_K75QSQC`).'
          }
        ],
        responses: {
          200: {
            description: 'Prices for the requested language.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PriceResponse' } } }
          },
          400: {
            description: 'price_dis is not one of the permitted discounts.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          },
          401: { $ref: '#/components/responses/Unauthorized' }
        }
      }
    },

    '/payment/first-sale/create-payment-intent': {
      post: {
        tags: ['Payment'],
        summary: 'Create Stripe PaymentIntent for the first sale',
        description:
          'Charges in the language-specific currency (JPY 2,980 for ja / GBP 19.99 for en) and records a pending transaction.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/FirstSaleIntentRequest' },
              example: { quiz_id: 'a1b2c3d4e5f6', language: 'ja', price_dis: 20 }
            }
          }
        },
        responses: {
          200: {
            description: 'PaymentIntent created for the (optionally discounted) amount.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PaymentIntentResponse' } } }
          },
          400: {
            description: 'Validation error, or Stripe rejected the request.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' }
        }
      }
    },

    '/payment/first-sale/payments/confirm': {
      post: {
        tags: ['Payment'],
        summary: 'Settle the first sale right after the browser confirms it',
        description:
          'Call this as soon as `stripe.confirmPayment()` succeeds in the browser. The backend re-reads ' +
          'the PaymentIntent from Stripe (the client claim is never trusted), settles the stored ' +
          'transaction, activates the customer, and returns the recomputed `redirect_url` so the funnel ' +
          'advances immediately instead of waiting for the webhook. The webhook still runs and applies ' +
          'the same state, so whichever arrives first wins and the other is a no-op. ' +
          'On a paid first sale it also starts the recurring subscription on the same saved card ' +
          '(see the `subscription` block) — that step is best-effort and never fails this request.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/FirstSaleConfirmRequest' },
              example: { quiz_id: 'a1b2c3d4e5f6', payment_intent_id: 'pi_3Q...' }
            }
          }
        },
        responses: {
          200: {
            description:
              'Confirmation processed. A 200 does not by itself mean paid — check `paid` and `redirect_url`.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/FirstSaleConfirmResponse' } } }
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: {
            description: 'Quiz result not found, or no first_sale transaction matches this quiz_id + payment_intent_id.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          },
          502: {
            description: 'Stripe could not be reached to verify the payment.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          }
        }
      }
    },

    '/payment/cross-sale/confirm': {
      post: {
        tags: ['Payment'],
        summary: 'Confirm the cross-sale (upsell) using the saved card',
        description:
          'One-click upsell: there is no payment sheet. Charges the payment method saved during the ' +
          'first sale off-session (JPY 1,480 for ja / GBP 9.99 for en) and settles the transaction ' +
          'immediately. Requires a succeeded first sale — that is where the card was stored. ' +
          'Calling it again after success returns the stored state without charging twice.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PaymentIntentRequest' },
              example: { quiz_id: 'a1b2c3d4e5f6', language: 'ja' }
            }
          }
        },
        responses: {
          200: {
            description:
              'Charge attempted. A 200 does not by itself mean paid — check `paid` / `requires_action`.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/CrossSaleConfirmResponse' } } }
          },
          400: {
            description: 'Validation error, or the saved card was declined.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
          409: {
            description:
              'The first sale has not succeeded yet, or no saved payment method is available for this customer.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          }
        }
      }
    },

    '/payment/webhook': {
      post: {
        tags: ['Payment'],
        summary: 'Stripe webhook',
        description:
          'Called by Stripe, not by the frontend. Skips the API key check and verifies the `stripe-signature` header against STRIPE_WEBHOOK_SECRET, so it cannot be exercised from this page — use the Stripe CLI (`stripe listen --forward-to localhost:5000/payment/webhook`).',
        security: [],
        parameters: [
          {
            name: 'stripe-signature',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description: 'Signature generated by Stripe over the raw request body.'
          }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', description: 'Raw Stripe Event object.' } } }
        },
        responses: {
          200: {
            description: 'Event received.',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { received: { type: 'boolean', example: true } } }
              }
            }
          },
          400: {
            description: 'Signature verification failed.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
          }
        }
      }
    },

    '/customer/update': {
      put: {
        tags: ['Customer'],
        summary: 'Update customer demographics',
        description: 'Saves the name and age printed on the certificate.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CustomerUpdateRequest' },
              example: { quiz_id: 'a1b2c3d4e5f6', first_name: '太郎', last_name: '山田', age: '30' }
            }
          }
        },
        responses: {
          200: {
            description: 'Details saved.',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/SuccessEnvelope' },
                    {
                      type: 'object',
                      properties: {
                        message: { type: 'string', example: 'Customer details updated successfully' },
                        data: { type: 'object', properties: { updated: { type: 'boolean', example: true } } }
                      }
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
  }
};

/**
 * The spec with its `servers` list resolved against the request that asked for it.
 *
 * Swagger UI sends every "Try it out" call to `servers[0]`, so whatever sits
 * there is the base URL a reader ends up hitting. Pinning that to `APP_URL` made
 * it only ever as correct as that one variable: deployed with the default still
 * in place, the production docs invite everyone to call `http://localhost:5000`.
 *
 * Deriving the origin from the incoming request removes the variable from the
 * loop entirely — the docs point at the domain they were served from, whatever
 * that is, and a new environment needs no config to be right.
 *
 * Two things this depends on:
 *   - `trust proxy` being set (see app.ts), or `req.protocol` reports the
 *     plaintext hop behind a TLS-terminating proxy and every URL comes out
 *     `http://` on an HTTPS site.
 *   - `Host` being trustworthy. It is attacker-controlled in general, but the
 *     only thing it can affect here is which URL a human sees in a docs page
 *     they already chose to open — no token, cookie or redirect keys off it.
 */
export function swaggerSpecFor(req: { protocol: string; get(name: string): string | undefined }) {
  const host = req.get('host');
  const servers: { url: string; description: string }[] = [];

  if (host) {
    servers.push({ url: `${req.protocol}://${host}`, description: 'This server' });
  }

  // Kept as a secondary entry: when it disagrees with the request origin — a
  // proxy rewriting the path, say — the reader can pick the other one rather
  // than being stuck with a base URL that does not work.
  //
  // Except when it points at loopback on a production box, which is the default
  // nobody remembered to change. That entry cannot work for any reader of a
  // deployed docs page, so offering it only invites someone to select it and
  // wonder why every call fails.
  const appUrlIsLoopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(
    config.appUrl
  );
  const hideAppUrl = config.env === 'production' && appUrlIsLoopback;
  if (config.appUrl && !hideAppUrl && !servers.some((s) => s.url === config.appUrl)) {
    servers.push({ url: config.appUrl, description: 'Configured APP_URL' });
  }

  // Offering localhost on a production docs page is noise at best and a
  // confusing dead end at worst, so it appears only where it can work.
  const localUrl = `http://localhost:${config.port}`;
  if (config.env !== 'production' && !servers.some((s) => s.url === localUrl)) {
    servers.push({ url: localUrl, description: 'Local development' });
  }

  // `servers` must be non-empty to be valid, and a request with no Host header
  // and no APP_URL could otherwise get here empty-handed.
  if (servers.length === 0) {
    servers.push({ url: localUrl, description: 'Local development' });
  }

  return { ...swaggerSpec, servers };
}
