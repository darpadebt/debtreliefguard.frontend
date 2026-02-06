(function() {
  const AB_BASE = (window.__AB015_BASE || '/api/mesh/015-a-b-test-accelerator').replace(/\/$/, '');
  const buildEndpoint = (path) => {
    const base = AB_BASE.startsWith('http') ? AB_BASE : `${window.location.origin}${AB_BASE}`;
    return `${base}${path}`;
  };

  const state = {
    site: null,
    corrKey: null,
    correlation_id: null,
    context: {},
    variants: {},
    labels: {},
  };

  const SLOT_SCOPES = [
    'homepage_buttons',
    'blog_mid_segue',
    'blog_end_cta',
    'hero_headline',
    'nav_cta',
    'form_next',
    'form_submit',
    'lead_anchor',
  ];

  const getDeviceType = () => (window.matchMedia('(max-width: 900px)').matches ? 'mobile' : 'desktop');

  const getVisitorType = () => {
    const seenKey = 'ab_seen';
    const seen = localStorage.getItem(seenKey);
    if (!seen) {
      localStorage.setItem(seenKey, '1');
      return 'new';
    }
    return 'returning';
  };

  const generateBucket = () => {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  };

  const getBucket = () => {
    let bucket = localStorage.getItem('ab_bucket');
    if (!bucket) {
      bucket = generateBucket();
      localStorage.setItem('ab_bucket', bucket);
    }
    return bucket;
  };

  const getTrafficSource = () => {
    const params = new URLSearchParams(window.location.search);
    const hasUtm = Array.from(params.keys()).some((key) => key.startsWith('utm_'));
    if (hasUtm) {
      return (
        params.get('utm_source') ||
        params.get('utm_medium') ||
        params.get('utm_campaign') ||
        params.get('utm_term') ||
        params.get('utm_content') ||
        'utm'
      );
    }
    const ref = document.referrer;
    if (!ref) return 'direct';
    try {
      const refUrl = new URL(ref);
      if (refUrl.host === window.location.host) return 'internal';
      return 'referral';
    } catch (err) {
      return 'referral';
    }
  };

  const getPagePath = () => {
    const { pathname, search } = window.location;
    return `${pathname}${search || ''}`;
  };

  const init = ({ site, corrKey }) => {
    state.site = site;
    state.corrKey = corrKey;
    state.correlation_id = localStorage.getItem(corrKey) || null;
    state.context = {
      device_type: getDeviceType(),
      visitor_type: getVisitorType(),
      bucket: getBucket(),
      traffic_source: getTrafficSource(),
      time_bucket: new Date().getHours().toString(),
      page_path: getPagePath(),
    };
  };

  const buildParams = (payload) => {
    const params = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      params.set(key, String(value));
    });
    return params;
  };

  const resolve = async ({ test_id, scope, page_type, funnel_stage, step_index }) => {
    if (!state.site || !state.corrKey) return null;
    const params = buildParams({
      site: state.site,
      corr_key: state.corrKey,
      correlation_id: state.correlation_id || '',
      test_id,
      scope,
      page_type,
      funnel_stage,
      step_index,
      device_type: state.context.device_type,
      visitor_type: state.context.visitor_type,
      bucket: state.context.bucket,
      traffic_source: state.context.traffic_source,
      time_bucket: state.context.time_bucket,
      page_path: state.context.page_path,
    });

    let timeoutId;
    try {
      const url = new URL(buildEndpoint('/cta'));
      url.search = params.toString();
      const controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), 2000);
      const res = await fetch(url.toString(), {
        method: 'GET',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = await res.json();
      const correlationId = data?.correlation_id || data?.corr_id || data?.correlationId;
      if (correlationId) {
        state.correlation_id = correlationId;
        localStorage.setItem(state.corrKey, correlationId);
      }
      const variant = data?.variant || data?.meta?.variant || data?.variant_id;
      if (variant) {
        state.variants[scope] = variant;
      }
      if (typeof data?.meta?.text === 'string' && data.meta.text.trim()) {
        state.labels[scope] = data.meta.text.trim();
      }
      return data;
    } catch (err) {
      return null;
    } finally {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    }
  };

  const track = ({ event, test_id, scope, variant, page_type, funnel_stage, step_index }) => {
    if (!state.site || !state.corrKey) return;
    const resolvedVariant = variant || state.variants[scope] || '';
    const payload = {
      site: state.site,
      corr_key: state.corrKey,
      correlation_id: state.correlation_id || '',
      event,
      test_id,
      scope,
      variant: resolvedVariant,
      page_type,
      funnel_stage,
      step_index,
      device_type: state.context.device_type,
      visitor_type: state.context.visitor_type,
      bucket: state.context.bucket,
      traffic_source: state.context.traffic_source,
      time_bucket: state.context.time_bucket,
      page_path: state.context.page_path,
    };

    void fetch(buildEndpoint('/track'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  };

  const applyLabel = (el, label) => {
    if (!el || !label) return;
    const textNodes = Array.from(el.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE);
    const targetNode = textNodes.find((node) => node.textContent && node.textContent.trim().length) || textNodes[0];
    if (targetNode) {
      targetNode.textContent = label;
    } else {
      el.textContent = label;
    }
    el.setAttribute('aria-label', label);
  };

  const getPageMeta = () => {
    const path = window.location.pathname;
    if (path.includes('blog')) {
      return { page_type: 'blog', funnel_stage: 'blog' };
    }
    if (path === '/' || path === '/index.html') {
      return { page_type: 'home', funnel_stage: 'leadflow' };
    }
    return { page_type: 'info', funnel_stage: 'info' };
  };

  const getStepIndex = () => {
    if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
      if (typeof window.step === 'number') return String(window.step);
      const pane = document.querySelector('.step-pane:not([hidden])');
      if (pane && pane.dataset.step) return String(pane.dataset.step);
    }
    return '0';
  };

  const hasBlogSlots = () => {
    return Boolean(
      document.querySelector('[data-ab-slot="blog_mid_segue"], [data-ab-slot="blog_end_cta"]')
    );
  };

  const hasEmbeddedBlogAbConfig = () => {
    return Array.from(document.scripts).some((script) => {
      const content = script.textContent || '';
      const src = script.src || '';
      const hasInline =
        content.includes('/ab-config') ||
        content.includes('/api/mesh/015-a-b-test-accelerator/ab-config') ||
        content.includes('015-a-b-test-accelerator');
      const hasSrc =
        src.includes('/ab-config') ||
        src.includes('/api/mesh/015-a-b-test-accelerator/ab-config') ||
        src.includes('015-a-b-test-accelerator');
      return hasInline || hasSrc;
    });
  };

  const setupCtas = () => {
    const { page_type, funnel_stage } = getPageMeta();
    const step_index = getStepIndex();
    const slots = [];
    const seen = new Set();
    const scopeCache = new Map();
    const hasBlogConfigScript = page_type === 'blog' && hasBlogSlots() && hasEmbeddedBlogAbConfig();

    const addSlot = (el, scope, options = {}) => {
      if (!SLOT_SCOPES.includes(scope)) return false;
      if (!el || seen.has(el)) return false;
      if (el.dataset && el.dataset.abApplied === '1') return false;
      seen.add(el);
      slots.push({
        el,
        scope,
        clickable: options.clickable !== false,
        trackExposure: options.trackExposure === true,
        test_id: `drg_${scope}`,
      });
      return true;
    };

    document.querySelectorAll('[data-ab-slot]').forEach((el) => {
      const slotName = el.getAttribute('data-ab-slot');
      if (!slotName) return;
      if (
        hasBlogConfigScript &&
        (slotName === 'blog_mid_segue' || slotName === 'blog_end_cta')
      ) {
        return;
      }
      const trackExposure = el.getAttribute('data-ab-track') === 'exposure';
      const clickable = el.getAttribute('data-ab-click') !== 'false';
      addSlot(el, slotName, { clickable, trackExposure });
    });

    if (page_type === 'blog') {
      if (!hasBlogConfigScript) {
        document.querySelectorAll('.cta-section a.cta-button, .cta-section button.cta-button').forEach((el) => {
          addSlot(el, 'blog_end_cta');
        });
      }
    } else {
      document.querySelectorAll('nav a.btn.primary.cta-unlock[href="/#leadForm"]').forEach((el) => {
        addSlot(el, 'nav_cta');
      });

      const nextBtn = document.getElementById('nextBtn');
      if (nextBtn) addSlot(nextBtn, 'form_next');
      const submitBtn = document.getElementById('submitBtn');
      if (submitBtn) addSlot(submitBtn, 'form_submit');

      document.querySelectorAll('a[href*="#leadForm"]').forEach((el) => {
        if (el.hasAttribute('data-ab-slot')) return;
        addSlot(el, 'lead_anchor');
      });

      document.querySelectorAll('a.btn.primary, a.btn.btn-primary, a.lead-cta-button, button.btn-primary').forEach(
        (el) => {
          if (el.hasAttribute('data-ab-slot')) return;
          addSlot(el, 'homepage_buttons');
        }
      );
    }

    const resolveScope = (scope, test_id) => {
      if (!scopeCache.has(scope)) {
        scopeCache.set(scope, resolve({ test_id, scope, page_type, funnel_stage, step_index }));
      }
      return scopeCache.get(scope);
    };

    slots.forEach(async ({ el, test_id, scope, clickable, trackExposure }) => {
      const response = await resolveScope(scope, test_id);
      const responseLabel =
        typeof response?.meta?.text === 'string' && response.meta.text.trim()
          ? response.meta.text.trim()
          : null;
      const cachedLabel = typeof state.labels[scope] === 'string' ? state.labels[scope] : null;
      const label = responseLabel || cachedLabel;
      if (label) {
        applyLabel(el, label);
        el.dataset.abApplied = '1';
      }
      if (trackExposure && label) {
        const liveStepIndex = getStepIndex();
        track({
          event: 'exposure',
          test_id,
          scope,
          variant: state.variants[scope],
          page_type,
          funnel_stage,
          step_index: liveStepIndex,
        });
      }
      if (clickable && label) {
        el.addEventListener(
          'click',
          () => {
            const liveStepIndex = getStepIndex();
            track({
              event: 'click',
              test_id,
              scope,
              variant: state.variants[scope],
              page_type,
              funnel_stage,
              step_index: liveStepIndex,
            });
          },
          { passive: true }
        );
      }
    });
  };

  window.__AB015 = {
    init,
    resolve,
    track,
    applyLabel,
    _variants: state.variants,
    _labels: state.labels,
  };

  document.addEventListener('DOMContentLoaded', () => {
    window.__AB015.init({ site: 'DRG', corrKey: 'ab_corr_DRG' });
    setupCtas();
    let attempts = 0;
    const maxAttempts = 2;
    const retrySetup = () => {
      attempts += 1;
      setupCtas();
      if (attempts >= maxAttempts) {
        return;
      }
      window.setTimeout(retrySetup, 600);
    };
    window.setTimeout(retrySetup, 600);

    const observer = new MutationObserver(() => {
      const nextBtn = document.getElementById('nextBtn');
      const submitBtn = document.getElementById('submitBtn');
      const navCta = document.querySelector('nav a.btn.primary.cta-unlock[href="/#leadForm"]');
      if (nextBtn || submitBtn || navCta) {
        setupCtas();
        observer.disconnect();
      }
    });
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  });
})();
