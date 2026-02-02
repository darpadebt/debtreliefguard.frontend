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

  const localLabelMap = {};

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

  const getBucket = () => localStorage.getItem('ab_bucket') || '';

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

    try {
      const url = new URL(buildEndpoint('/cta'));
      url.search = params.toString();
      const res = await fetch(url.toString(), { method: 'GET', credentials: 'same-origin' });
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
      if (data?.meta?.label) {
        state.labels[scope] = data.meta.label;
      }
      return data;
    } catch (err) {
      return null;
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

  const getPageSlug = () => {
    const path = window.location.pathname.replace(/^\//, '').replace(/\.html$/, '');
    return path || 'home';
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

  const setupCtas = () => {
    const pageSlug = getPageSlug();
    const { page_type, funnel_stage } = getPageMeta();
    const step_index = getStepIndex();
    const slots = [];
    const seen = new Set();

    const addSlot = (el, slotName, options = {}) => {
      if (!el || seen.has(el)) return false;
      seen.add(el);
      slots.push({
        el,
        slotName,
        clickable: options.clickable !== false,
        trackExposure: options.trackExposure === true,
        test_id: `drg_${pageSlug}_${slotName}`,
        scope: `DRG:${pageSlug}:${slotName}`,
      });
      return true;
    };

    document.querySelectorAll('[data-ab-slot]').forEach((el) => {
      const slotName = el.getAttribute('data-ab-slot');
      if (!slotName) return;
      const trackExposure = el.getAttribute('data-ab-track') === 'exposure';
      const clickable = el.getAttribute('data-ab-click') !== 'false';
      addSlot(el, slotName, { clickable, trackExposure });
    });

    document.querySelectorAll('nav a.btn.primary.cta-unlock[href="/#leadForm"]').forEach((el) => {
      addSlot(el, 'nav_unlock');
    });

    const nextBtn = document.getElementById('nextBtn');
    if (nextBtn) addSlot(nextBtn, 'nextBtn');
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) addSlot(submitBtn, 'submitBtn');

    let telCount = 0;
    document.querySelectorAll('a[href^="tel:"]').forEach((el) => {
      if (addSlot(el, `tel_link_${telCount + 1}`)) telCount += 1;
    });

    let leadCount = 0;
    document.querySelectorAll('a[href*="#leadForm"]').forEach((el) => {
      if (addSlot(el, `lead_anchor_${leadCount + 1}`)) leadCount += 1;
    });

    let primaryCount = 0;
    document.querySelectorAll('.btn.primary, a.btn.primary, button.btn.primary').forEach((el) => {
      if (addSlot(el, `primary_btn_${primaryCount + 1}`)) primaryCount += 1;
    });

    if (page_type === 'blog') {
      let blogCount = 0;
      document
        .querySelectorAll('a.lead-cta-button, a.cta-button, a[data-cta], .inline-cta a')
        .forEach((el) => {
          if (addSlot(el, `blog_cta_${blogCount + 1}`)) blogCount += 1;
        });
    }

    slots.forEach(async ({ el, slotName, test_id, scope, clickable, trackExposure }) => {
      const response = await resolve({ test_id, scope, page_type, funnel_stage, step_index });
      const label = response?.meta?.label || localLabelMap[test_id] || el.textContent?.trim();
      if (label) applyLabel(el, label);
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
      if (clickable) {
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
  });
})();
