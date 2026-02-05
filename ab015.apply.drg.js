(function() {
  'use strict';

  const DEBUG = false;
  const BASE_PATH = '/api/mesh/015-ab-test-accelerator/variant';
  const CTA_KEYWORDS = ['help', 'relief', 'qualify', 'eligibility', 'check', 'now', 'start', 'reduce'];
  const CTA_TOKENS = ['cta', 'start', 'relief', 'hero', 'button'];

  const log = (...args) => {
    if (!DEBUG) return;
    console.log('[ab015.apply.drg]', ...args);
  };

  const safeMatch = (value, tokens) => {
    if (!value) return false;
    const lower = value.toLowerCase();
    return tokens.some((token) => lower.includes(token));
  };

  const getDeviceType = () => (window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop');

  const randomId = (prefix) => {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}_${window.crypto.randomUUID()}`;
    }
    return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  };

  const getCookie = (name) => {
    if (!document.cookie) return null;
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [key, ...rest] = cookie.trim().split('=');
      if (key === name) return rest.join('=');
    }
    return null;
  };

  const setCookie = (name, value) => {
    try {
      document.cookie = `${name}=${value}; Path=/; SameSite=Lax`;
    } catch (err) {
      log('cookie write failed', err);
    }
  };

  let memorySid = null;
  let memoryVid = null;

  const getSessionId = () => {
    const existing = getCookie('gfsr_sid');
    if (existing) return existing;
    if (!memorySid) {
      memorySid = randomId('sid');
      setCookie('gfsr_sid', memorySid);
    }
    return memorySid;
  };

  const getVisitorId = () => {
    try {
      const existing = window.localStorage.getItem('gfsr_vid');
      if (existing) return existing;
      const created = randomId('vid');
      window.localStorage.setItem('gfsr_vid', created);
      return created;
    } catch (err) {
      if (!memoryVid) memoryVid = randomId('vid');
      return memoryVid;
    }
  };

  const buildVariantUrl = (slot, index) => {
    const params = new URLSearchParams({
      site: 'DRG',
      slot,
      page: window.location.pathname,
      device: getDeviceType(),
      sid: getSessionId(),
      vid: getVisitorId(),
    });
    if (typeof index === 'number') params.set('n', String(index));
    return `${BASE_PATH}?${params.toString()}`;
  };

  const fetchVariant = async (slot, index) => {
    try {
      const url = buildVariantUrl(slot, index);
      const res = await fetch(url, { method: 'GET', credentials: 'same-origin' });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      return null;
    }
  };

  const runWhenIdle = (fn) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => {
        try {
          fn();
        } catch (err) {
          log('idle task failed', err);
        }
      });
    } else {
      window.setTimeout(() => {
        try {
          fn();
        } catch (err) {
          log('timeout task failed', err);
        }
      }, 0);
    }
  };

  const isEligibleCta = (el) => {
    if (!el || !(el instanceof HTMLElement)) return false;
    const tag = el.tagName.toLowerCase();
    if (tag !== 'a' && tag !== 'button') return false;
    const text = el.textContent || '';
    const className = el.className ? String(el.className) : '';
    const id = el.id || '';
    return (
      safeMatch(text, CTA_KEYWORDS) ||
      safeMatch(className, CTA_TOKENS) ||
      safeMatch(id, CTA_TOKENS)
    );
  };

  const replaceText = (el, value) => {
    if (!el || !value) return;
    el.textContent = value;
  };

  const applyHomepageButtons = async () => {
    const ctas = Array.from(document.querySelectorAll('a, button')).filter(isEligibleCta);
    if (!ctas.length) return;

    const requestCount = Math.max(3, Math.min(5, ctas.length));
    const responses = await Promise.all(
      Array.from({ length: requestCount }, (_, index) => fetchVariant('homepage_buttons', index + 1))
    );
    const variants = responses.map((data) => data?.variantText).filter(Boolean);
    if (!variants.length) return;

    const applyCount = Math.min(ctas.length, variants.length, 5);
    for (let i = 0; i < applyCount; i += 1) {
      replaceText(ctas[i], variants[i]);
    }
  };

  const isBlogArticlePage = () => {
    const path = window.location.pathname.toLowerCase();
    if (!path.startsWith('/blog/')) return false;
    return path !== '/blog/' && path !== '/blog/index.html';
  };

  document.addEventListener('DOMContentLoaded', () => {
    try {
      if (!isBlogArticlePage()) {
        runWhenIdle(() => {
          void applyHomepageButtons();
        });
      }
    } catch (err) {
      log('init failed', err);
    }
  });
})();
