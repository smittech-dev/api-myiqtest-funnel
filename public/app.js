/* IQ Funnel — static test harness.
   Drives the real API end to end: submit -> first sale -> cross sale -> details -> result.
   Payments are confirmed entirely in the browser with Stripe.js; the backend learns the
   outcome from the Stripe webhook, so `stripe listen` must be running for the funnel to advance. */

(function () {
  'use strict';

  var cfg = window.APP_CONFIG || {};
  var STORE_KEY = 'iq-funnel-harness';
  var DEFAULT_EMAIL = 'harness@example.com';

  var state = {
    quizId: null,
    stripe: null,
    firstSale: null, // { elements, clientSecret, amount, currency }
    crossSale: null,
    pricing: null,
    pricingKey: null
  };

  var el = {
    apiBase: document.getElementById('apiBase'),
    apiKey: document.getElementById('apiKey'),
    email: document.getElementById('email'),
    language: document.getElementById('language'),
    discount: document.getElementById('discount'),
    discountPersonalise: document.getElementById('discountPersonalise'),
    setupStatus: document.getElementById('setupStatus'),
    quizPayload: document.getElementById('quizPayload'),
    quizIdBadge: document.getElementById('quizIdBadge'),
    quizIdValue: document.getElementById('quizIdValue'),
    log: document.getElementById('log'),
    resultBody: document.getElementById('resultBody')
  };

  /* ---------------- settings ---------------- */

  function loadSettings() {
    var saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    } catch (e) {
      saved = {};
    }
    el.apiBase.value = saved.apiBase || cfg.apiBase || window.location.origin;
    el.apiKey.value = saved.apiKey !== undefined ? saved.apiKey : '';
    el.email.value = saved.email || DEFAULT_EMAIL;
    el.language.value = saved.language || 'ja';
    el.discount.value = saved.discount || '';
    el.discountPersonalise.checked = Boolean(saved.discountPersonalise);
  }

  function saveSettings() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          apiBase: el.apiBase.value.trim(),
          apiKey: el.apiKey.value.trim(),
          email: el.email.value.trim(),
          language: el.language.value,
          discount: el.discount.value.trim(),
          discountPersonalise: el.discountPersonalise.checked
        })
      );
    } catch (e) {
      /* private mode — settings just won't persist */
    }
  }

  ['apiBase', 'apiKey', 'email', 'language', 'discount', 'discountPersonalise'].forEach(function (k) {
    el[k].addEventListener('change', saveSettings);
  });

  /* ---------------- logging ---------------- */

  function log(method, path, status, body, note) {
    var entry = document.createElement('div');
    entry.className = 'entry';

    var codeClass = status >= 200 && status < 300 ? 'code-ok' : 'code-err';
    var head =
      '<span class="meth">' + method + '</span> ' +
      escapeHtml(path) +
      ' <span class="' + codeClass + '">' + (status || '—') + '</span>';
    if (note) head += ' <span class="note">' + escapeHtml(note) + '</span>';

    entry.innerHTML = head;

    if (body !== undefined) {
      var pre = document.createElement('pre');
      pre.textContent = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
      entry.appendChild(pre);
    }

    el.log.insertBefore(entry, el.log.firstChild);
  }

  function note(text, cls) {
    var entry = document.createElement('div');
    entry.className = 'entry';
    entry.innerHTML = '<span class="' + (cls || 'note') + '">' + escapeHtml(text) + '</span>';
    el.log.insertBefore(entry, el.log.firstChild);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- api ---------------- */

  function api(method, path, body) {
    var base = el.apiBase.value.trim().replace(/\/$/, '');
    var key = el.apiKey.value.trim();
    var headers = { 'Content-Type': 'application/json' };
    if (key) headers['x-api-key'] = key;

    var opts = { method: method, headers: headers };
    if (body !== undefined) opts.body = JSON.stringify(body);

    return fetch(base + path, opts).then(function (res) {
      return res
        .json()
        .catch(function () {
          return null;
        })
        .then(function (json) {
          log(method, path, res.status, json);
          if (!res.ok || !json || json.success === false) {
            var msg = (json && json.error && json.error.message) || 'HTTP ' + res.status;
            if (json && json.error && json.error.details) {
              msg += '\n' + JSON.stringify(json.error.details, null, 2);
            }
            throw new Error(msg);
          }
          return json.data;
        });
    });
  }

  /* ---------------- navigation ---------------- */

  var ORDER = ['quiz', 'checkout', 'crosssell', 'details', 'result'];

  function show(name) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.hidden = s.getAttribute('data-screen') !== name;
    });
    var idx = ORDER.indexOf(name);
    document.querySelectorAll('.steps li').forEach(function (li, i) {
      li.classList.toggle('active', i === idx);
      li.classList.toggle('done', i < idx);
    });
  }

  function setQuizId(id) {
    state.quizId = id;
    el.quizIdValue.textContent = id;
    el.quizIdBadge.hidden = !id;
  }

  function showError(id, message) {
    var box = document.getElementById(id);
    box.textContent = message;
    box.hidden = false;
  }

  function clearError(id) {
    var box = document.getElementById(id);
    box.textContent = '';
    box.hidden = true;
  }

  /* ---------------- step 1: quiz ---------------- */

  function quizPayload() {
    return {
      email: el.email.value.trim() || DEFAULT_EMAIL,
      iq_score: 128,
      category_scores: { logical: 32, spatial: 28, numerical: 30, memory: 25 },
      duration_seconds: 640,
      language: el.language.value,
      landing_url_details: {
        landing_url: window.location.origin + '/app',
        utm_source: 'test-harness'
      }
    };
  }

  function renderQuizPayload() {
    el.quizPayload.textContent = JSON.stringify(quizPayload(), null, 2);
  }

  document.getElementById('btnCompleteTest').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    api('POST', '/questions/submit', quizPayload())
      .then(function (data) {
        setQuizId(data.quiz_id);
        return api('GET', '/questions/results?quiz_id=' + encodeURIComponent(data.quiz_id));
      })
      .then(function () {
        show('checkout');
        return startSale('first');
      })
      .catch(function (err) {
        note('Submit failed: ' + err.message, 'code-err');
        alert('Submit failed:\n' + err.message);
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Complete test';
      });
  });

  /* ---------------- steps 2 & 3: payment ---------------- */

  /**
   * Discount code to send as price_dis, or '' for none.
   * Codes are opaque random strings, so the harness never hardcodes them — type one
   * from data/discount-codes.json. Ticking "personalise" prefixes it with the first
   * two letters of the email, exercising the backend's prefix-stripping path.
   */
  function selectedDiscountCode() {
    var code = el.discount.value.trim();
    if (!code) return '';
    if (el.discountPersonalise.checked) {
      var prefix = (el.email.value.trim() || DEFAULT_EMAIL).slice(0, 2).toLowerCase();
      return prefix + '_' + code;
    }
    return code;
  }

  /**
   * Prices come from the API, never from local arithmetic — the backend owns
   * rounding, so mirroring it here could disagree with what Stripe charges.
   * Cached per language+code for the session.
   */
  function fetchPricing() {
    var code = selectedDiscountCode();
    var key = el.language.value + '|' + code;

    if (state.pricingKey === key && state.pricing) {
      return Promise.resolve(state.pricing);
    }

    var qs = '/price?language=' + encodeURIComponent(el.language.value) +
      (code ? '&price_dis=' + encodeURIComponent(code) : '');

    return api('GET', qs).then(function (data) {
      state.pricing = data;
      state.pricingKey = key;
      return data;
    });
  }

  var SALES = {
    first: {
      path: '/payment/first-sale/create-payment-intent',
      priceEl: 'firstSalePrice',
      mountEl: 'firstSaleElement',
      errorEl: 'firstSaleError',
      payBtn: 'btnPayFirstSale',
      label: 'first sale',
      next: 'CROSS_SELL_PAGE',
      // Must mirror the PaymentIntent the backend creates: it sets
      // setup_future_usage='off_session' so the card can be reused for the upsell.
      setupFutureUsage: 'off_session'
    },
    cross: {
      path: '/payment/cross-sale/confirm',
      priceEl: 'crossSalePrice',
      errorEl: 'crossSaleError',
      payBtn: 'btnPayCrossSale',
      label: 'cross sale',
      next: 'CUSTOMER_DETAILS_PAGE'
    }
  };

  /**
   * Mount the card form WITHOUT creating a PaymentIntent.
   *
   * Nothing is recorded server-side until the customer actually clicks Pay — no
   * Stripe customer, no PaymentIntent, no pending transaction row.
   */
  function startSale(which) {
    var sale = SALES[which];
    clearError(sale.errorEl);

    if (!state.stripe) {
      showError(sale.errorEl, 'Stripe.js is not initialised — set STRIPE_PUBLISHABLE_KEY and reload.');
      return Promise.resolve();
    }

    return fetchPricing()
      .then(function (pricing) {
        var product = which === 'first' ? pricing.first_sale : pricing.cross_sale;
        var line = document.getElementById('firstSaleDiscount');

        document.getElementById(sale.priceEl).textContent = formatMoney(product.price, product.currency);

        if (which === 'first' && line) {
          if (product.discount_percentage > 0) {
            line.innerHTML =
              '<span class="was">' + escapeHtml(formatMoney(product.original_price, product.currency)) + '</span>' +
              '<span class="off">' + product.discount_percentage + '% off — code ' +
              escapeHtml(pricing.discount_code) + ' (sent as ' + escapeHtml(selectedDiscountCode()) + ')</span>';
            line.hidden = false;
          } else {
            line.hidden = true;
          }
        }

        // In the deferred-intent flow Stripe validates that these options match the
        // PaymentIntent created server-side, so any mismatch fails at confirm time.
        var elements = state.stripe.elements({
          mode: 'payment',
          amount: product.stripe_amount,
          currency: product.currency.toLowerCase(),
          setupFutureUsage: sale.setupFutureUsage || null,
          appearance: { theme: 'stripe' }
        });

        // Hide the billing country selector; supplied at confirm time instead.
        var paymentElement = elements.create('payment', {
          fields: { billingDetails: { address: { country: 'never' } } }
        });
        paymentElement.mount('#' + sale.mountEl);

        state[which === 'first' ? 'firstSale' : 'crossSale'] = {
          elements: elements,
          clientSecret: null,
          amount: product.price,
          currency: product.currency
        };

        document.getElementById(sale.payBtn).disabled = false;
        note('Checkout ready — nothing recorded server-side until you click Pay', 'note');
      })
      .catch(function (err) {
        showError(sale.errorEl, 'Could not load pricing:\n' + err.message);
      });
  }

  function paySale(which) {
    var sale = SALES[which];
    var store = state[which === 'first' ? 'firstSale' : 'crossSale'];
    var btn = document.getElementById(sale.payBtn);

    if (!store) return;

    clearError(sale.errorEl);
    btn.disabled = true;
    btn.textContent = 'Processing…';

    // THIS click is the initiation: validate the form, then ask the backend to
    // create the PaymentIntent (which is also what creates the transaction row
    // and the Stripe customer), and only then confirm.
    store.elements
      .submit()
      .then(function (res) {
        if (res.error) throw new Error(res.error.message || 'Please check your card details');
        var body = { quiz_id: state.quizId, language: el.language.value };
        if (which === 'first' && selectedDiscountCode()) {
          body.price_dis = selectedDiscountCode();
        }
        return api('POST', sale.path, body);
      })
      .then(function (data) {
        store.clientSecret = data.client_secret;
        note(
          'Payment initiated: ' + data.payment_intent_id +
            ' — charging ' + formatMoney(data.amount, data.currency) +
            (data.discount_percentage
              ? ' (was ' + formatMoney(data.original_amount, data.currency) +
                ', ' + data.discount_percentage + '% off, code ' + data.discount_code + ')'
              : ''),
          'code-ok'
        );

        // Confirm entirely in the browser. redirect: 'if_required' keeps card payments
        // (including 3DS) inline; return_url is still mandatory because the intent
        // enables automatic_payment_methods, so a redirect-based method could be chosen.
        return state.stripe.confirmPayment({
          elements: store.elements,
          clientSecret: data.client_secret,
          confirmParams: {
            return_url: window.location.origin + '/app',
            payment_method_data: {
              billing_details: {
                address: { country: billingCountry() }
              }
            }
          },
          redirect: 'if_required'
        });
      })
      .then(function (res) {
        if (res.error) throw new Error(res.error.message || 'Payment failed');

        var pi = res.paymentIntent;
        note('Stripe confirmed ' + sale.label + ': ' + pi.id + ' → ' + pi.status, 'code-ok');

        if (pi.status !== 'succeeded') {
          throw new Error('PaymentIntent ended in status "' + pi.status + '"');
        }

        // Tell the backend right away rather than waiting on the webhook, which can lag.
        return api('POST', '/payment/first-sale/payments/confirm', {
          quiz_id: state.quizId,
          payment_intent_id: pi.id
        });
      })
      .then(function (data) {
        if (!data.paid) {
          throw new Error('Backend reported the payment as "' + data.status + '"');
        }
        note('Backend settled the first sale → ' + data.redirect_url, 'code-ok');
        advanceAfter(which, data.redirect_url);
      })
      .catch(function (err) {
        showError(sale.errorEl, err.message);
        btn.disabled = false;
        btn.textContent = which === 'first' ? 'Pay now' : 'Add to my order';
      });
  }

  var REDIRECT_SCREENS = {
    CHECKOUT_PAGE: 'checkout',
    CROSS_SELL_PAGE: 'crosssell',
    CUSTOMER_DETAILS_PAGE: 'details',
    THANK_YOU_PAGE: 'result'
  };

  function advanceAfter(which, redirectUrl) {
    // The backend recomputes the funnel position, so follow it rather than guessing.
    var screen = REDIRECT_SCREENS[redirectUrl] || (which === 'first' ? 'crosssell' : 'details');

    if (screen === 'result') {
      loadResult();
      return;
    }

    show(screen);
    if (screen === 'crosssell') {
      showCrossSalePrice();
    }
  }

  /** The upsell has no payment sheet, so only the price is rendered up front. */
  function showCrossSalePrice() {
    fetchPricing().then(function (pricing) {
      document.getElementById('crossSalePrice').textContent =
        formatMoney(pricing.cross_sale.price, pricing.cross_sale.currency);
    });
  }

  /**
   * One-click upsell: a single call charges the saved card server-side.
   * 3D Secure can still be demanded, in which case we finish it in the browser.
   */
  function confirmCrossSale() {
    var sale = SALES.cross;
    var btn = document.getElementById(sale.payBtn);

    clearError(sale.errorEl);
    btn.disabled = true;
    btn.textContent = 'Charging saved card…';

    api('POST', sale.path, {
      quiz_id: state.quizId,
      language: el.language.value
    })
      .then(function (data) {
        if (data.paid) {
          note('Cross-sale charged to the saved card: ' + data.payment_intent_id, 'code-ok');
          return data.redirect_url;
        }

        if (data.requires_action && data.client_secret) {
          // Stripe leaves an off-session auth failure at requires_payment_method, not
          // requires_action, so handleNextAction only helps in the latter case.
          if (data.status === 'requires_action') {
            note('Saved card needs 3D Secure — running handleNextAction', 'note');
            return state.stripe.handleNextAction({ clientSecret: data.client_secret }).then(function (res) {
              if (res.error) throw new Error(res.error.message || 'Authentication failed');
              if (res.paymentIntent && res.paymentIntent.status === 'succeeded') {
                note('3D Secure passed: ' + res.paymentIntent.id, 'code-ok');
                // Settled by the webhook — wait for the guard to catch up.
                return waitForRedirect(sale.next);
              }
              throw new Error('Payment ended in status "' + (res.paymentIntent || {}).status + '"');
            });
          }

          throw new Error(
            'The saved card requires the customer to authenticate on-session (status "' +
              data.status +
              '").\nRecovering this needs a card form confirmed against the returned client_secret — ' +
              'out of scope for this harness. client_secret logged in the panel.'
          );
        }

        throw new Error('Cross-sale ended in status "' + data.status + '"');
      })
      .then(function (redirectUrl) {
        advanceAfter('cross', redirectUrl);
      })
      .catch(function (err) {
        showError(sale.errorEl, err.message);
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Add to my order';
      });
  }

  /**
   * Poll /questions/results until the redirect guard reports the expected page.
   * Returns false if it never gets there (webhook not running).
   */
  function waitForRedirect(expected, attempt) {
    attempt = attempt || 0;
    var MAX = 10;

    return api('GET', '/questions/results?quiz_id=' + encodeURIComponent(state.quizId))
      .then(function (data) {
        if (data.redirect_url === expected) {
          note('Redirect guard reached ' + expected, 'code-ok');
          return true;
        }
        if (attempt >= MAX) {
          note('Redirect guard still at ' + data.redirect_url + ' after ' + MAX + ' polls', 'code-err');
          return false;
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, 800);
        }).then(function () {
          return waitForRedirect(expected, attempt + 1);
        });
      })
      .catch(function () {
        return false;
      });
  }

  document.getElementById('btnPayFirstSale').addEventListener('click', function () {
    paySale('first');
  });

  document.getElementById('btnPayCrossSale').addEventListener('click', function () {
    confirmCrossSale();
  });

  document.getElementById('btnSkipCrossSale').addEventListener('click', function () {
    note('Cross-sell skipped (client-side only — the API has no "declined upsell" state)', 'note');
    show('details');
  });

  /* ---------------- step 4: details ---------------- */

  document.getElementById('btnSaveDetails').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Saving…';

    api('PUT', '/customer/update', {
      quiz_id: state.quizId,
      first_name: document.getElementById('firstName').value,
      last_name: document.getElementById('lastName').value,
      age: document.getElementById('age').value
    })
      .then(function () {
        return loadResult();
      })
      .catch(function (err) {
        alert('Could not save details:\n' + err.message);
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Save and continue';
      });
  });

  /* ---------------- step 5: result ---------------- */

  function loadResult() {
    return api('GET', '/questions/results?quiz_id=' + encodeURIComponent(state.quizId)).then(
      function (data) {
        var q = data.quiz;
        var c = data.customer;
        var scores = q.category_scores || {};

        el.resultBody.innerHTML =
          '<dl class="result-grid">' +
          row('Redirect guard', '<span class="badge">' + escapeHtml(data.redirect_url) + '</span>') +
          row('Name', escapeHtml([c.last_name, c.first_name].filter(Boolean).join(' ') || '—')) +
          row('Email', escapeHtml(c.email)) +
          row('Age', escapeHtml(c.age || '—')) +
          row('IQ score', escapeHtml(String(q.iq_score))) +
          row('Duration', q.duration_seconds != null ? q.duration_seconds + 's' : '—') +
          row('Language', escapeHtml(q.language)) +
          row(
            'Categories',
            Object.keys(scores).length
              ? escapeHtml(
                  Object.keys(scores)
                    .map(function (k) {
                      return k + ' ' + scores[k];
                    })
                    .join(' · ')
                )
              : '—'
          ) +
          '</dl>';

        show('result');
      }
    );
  }

  function row(label, value) {
    return '<dt>' + label + '</dt><dd>' + value + '</dd>';
  }

  document.getElementById('btnRestart').addEventListener('click', function () {
    state.quizId = null;
    state.firstSale = null;
    state.crossSale = null;
    el.quizIdBadge.hidden = true;
    document.getElementById('firstSaleElement').innerHTML = '';
    document.getElementById('btnPayFirstSale').disabled = true;
    document.getElementById('btnPayFirstSale').textContent = 'Pay now';
    document.getElementById('btnPayCrossSale').disabled = false;
    document.getElementById('btnPayCrossSale').textContent = 'Add to my order';
    clearError('firstSaleError');
    clearError('crossSaleError');
    renderQuizPayload();
    show('quiz');
  });

  document.getElementById('btnCheckPrice').addEventListener('click', function () {
    var box = document.getElementById('pricePreview');
    state.pricingKey = null; // force a fresh call so the button always hits the API

    fetchPricing()
      .then(function (data) {
        box.innerHTML =
          '<table><tr><th>Product</th><th>List</th><th>Charged</th><th>Off</th></tr>' +
          priceRow('First sale', data.first_sale) +
          priceRow('Cross-sale', data.cross_sale) +
          priceRow('Subscription', data.subscription) +
          '</table>';
        box.hidden = false;
      })
      .catch(function (err) {
        box.innerHTML = '<span style="color:var(--err)">' + escapeHtml(err.message) + '</span>';
        box.hidden = false;
      });
  });

  function priceRow(label, p) {
    var off = p.discount_percentage > 0;
    return (
      '<tr><td>' + label + '</td>' +
      '<td class="' + (off ? 'was' : '') + '">' + escapeHtml(formatMoney(p.original_price, p.currency)) + '</td>' +
      '<td class="' + (off ? 'now' : '') + '">' + escapeHtml(formatMoney(p.price, p.currency)) + '</td>' +
      '<td>' + (off ? p.discount_percentage + '%' : '—') + '</td></tr>'
    );
  }

  document.getElementById('btnClearLog').addEventListener('click', function () {
    el.log.innerHTML = '';
  });

  /* ---------------- helpers ---------------- */

  /** Country the funnel bills against, mirroring the backend's language -> country_code. */
  function billingCountry() {
    return el.language.value === 'en' ? 'US' : 'JP';
  }

  function formatMoney(amount, currency) {
    try {
      return new Intl.NumberFormat(currency === 'JPY' ? 'ja-JP' : 'en-US', {
        style: 'currency',
        currency: currency
      }).format(amount);
    } catch (e) {
      return amount + ' ' + currency;
    }
  }

  /* ---------------- boot ---------------- */

  function boot() {
    loadSettings();
    renderQuizPayload();
    el.language.addEventListener('change', renderQuizPayload);
    el.email.addEventListener('input', renderQuizPayload);
    el.discountPersonalise.addEventListener('change', remountCheckout);
    el.discount.addEventListener('change', remountCheckout);

    function remountCheckout() {
      // Re-mount so the card form is built for the newly selected amount
      state.pricingKey = null;
      var checkout = document.querySelector('[data-screen="checkout"]');
      if (state.quizId && checkout && !checkout.hidden) {
        document.getElementById('firstSaleElement').innerHTML = '';
        startSale('first');
      }
    }

    var lines = [];

    if (!window.Stripe) {
      lines.push('<div class="err">Stripe.js failed to load — check your network/CSP.</div>');
    } else if (!cfg.stripePublishableKey) {
      lines.push(
        '<div class="err">STRIPE_PUBLISHABLE_KEY is not set. Add it to .env and restart; payment steps will not work.</div>'
      );
    } else {
      state.stripe = window.Stripe(cfg.stripePublishableKey);
      lines.push('<div class="ok">Stripe.js ready (' + escapeHtml(cfg.stripePublishableKey.slice(0, 12)) + '…)</div>');
    }

    if (cfg.apiKeyRequired && !el.apiKey.value.trim()) {
      lines.push(
        '<div class="warn">This server has API_KEY set — paste it into the x-api-key field or every call returns 401.</div>'
      );
    }

    lines.push(
      '<div class="warn">The funnel advances from the confirm endpoints, so it works without the ' +
        'Stripe CLI. Run it anyway to exercise the webhook path:<br>' +
        '<code>stripe listen --forward-to localhost:' +
        escapeHtml(String(cfg.port || 5000)) +
        '/payment/webhook</code></div>'
    );

    el.setupStatus.innerHTML = lines.join('');
    show('quiz');
  }

  boot();
})();
