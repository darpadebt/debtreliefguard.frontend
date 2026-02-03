(function () {
  "use strict";

  var SITE_LABEL = "DRG";
  var SESSION_COOKIE = "gfsr_sid";
  var VISITOR_KEY = "gfsr_vid";
  var FORM_START_KEY = "gfsr_form_start";
  var SHOW_FORM_KEY = "gfsr_show_form";
  var CTA_RATE_LIMIT = 10;
  var CTA_RATE_WINDOW_MS = 60 * 1000;
  var HEARTBEAT_INTERVAL_MS = 15000;
  var SCROLL_THRESHOLDS = [25, 50, 75];

  function safeGetCookie(name) {
    try {
      var match = document.cookie.match(new RegExp("(^|; )" + name + "=([^;]*)"));
      return match ? decodeURIComponent(match[2]) : "";
    } catch (err) {
      return "";
    }
  }

  function safeSetCookie(name, value) {
    try {
      document.cookie =
        name + "=" + encodeURIComponent(value) + "; Path=/; SameSite=Lax";
    } catch (err) {
      return;
    }
  }

  function safeGetStorage(storage, key) {
    try {
      return storage.getItem(key) || "";
    } catch (err) {
      return "";
    }
  }

  function safeSetStorage(storage, key, value) {
    try {
      storage.setItem(key, value);
    } catch (err) {
      return;
    }
  }

  function randomId(prefix) {
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        var buf = new Uint32Array(2);
        window.crypto.getRandomValues(buf);
        return prefix + buf[0].toString(16) + buf[1].toString(16);
      }
    } catch (err) {
      // ignore
    }
    return prefix + Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function getSessionId() {
    var sid = safeGetCookie(SESSION_COOKIE);
    if (!sid) {
      sid = randomId("sid_");
      safeSetCookie(SESSION_COOKIE, sid);
    }
    return sid;
  }

  function getVisitorId() {
    var vid = safeGetStorage(window.localStorage, VISITOR_KEY);
    if (!vid) {
      vid = randomId("vid_");
      safeSetStorage(window.localStorage, VISITOR_KEY, vid);
    }
    return vid;
  }

  function buildBasePayload() {
    return {
      site: SITE_LABEL,
      path: window.location.pathname + window.location.search + window.location.hash,
      referrer: document.referrer || "",
      ts: new Date().toISOString(),
      sessionId: getSessionId(),
      visitorId: getVisitorId()
    };
  }

  function scheduleSend(payload, immediate) {
    if (immediate) {
      sendPayload(payload);
      return;
    }
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(function () {
        sendPayload(payload);
      });
      return;
    }
    setTimeout(function () {
      sendPayload(payload);
    }, 0);
  }

  function sendPayload(payload) {
    try {
      fetch("/api/mesh/038-engagement-router/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "same-origin",
        keepalive: true
      })
        .then(function (response) {
          if (!response) {
            return null;
          }
          return response
            .json()
            .then(function (data) {
              if (!data) {
                return;
              }
              if (data.action === "show_form") {
                try {
                  var flagged = safeGetStorage(window.sessionStorage, SHOW_FORM_KEY);
                  if (flagged) {
                    return;
                  }
                  safeSetStorage(window.sessionStorage, SHOW_FORM_KEY, "1");
                  window.dispatchEvent(
                    new CustomEvent("gfsr:showLeadForm", { detail: data })
                  );
                } catch (err) {
                  return;
                }
              }
            })
            .catch(function () {
              return;
            });
        })
        .catch(function () {
          return;
        });
    } catch (err) {
      return;
    }
  }

  function isLeadForm(form) {
    if (!form || form.nodeName !== "FORM") {
      return false;
    }
    var idClass =
      (form.id || "") + " " + (form.className || "").toString();
    if (/lead|start|eligib|debt|relief|form/i.test(idClass)) {
      return true;
    }
    var action = form.getAttribute("action") || "";
    if (/lead|form|apply|start|eligib/i.test(action)) {
      return true;
    }
    var inputs = form.querySelectorAll("input, select, textarea");
    var fieldMatch = 0;
    for (var i = 0; i < inputs.length; i += 1) {
      var name = inputs[i].name || inputs[i].id || "";
      if (/email|phone|zip|state|debt|amount/i.test(name)) {
        fieldMatch += 1;
      }
    }
    return fieldMatch >= 2;
  }

  function getCtaLabel(el) {
    if (!el) {
      return "";
    }
    var text = (el.textContent || "").trim();
    if (text) {
      return text.slice(0, 80);
    }
    if (el.id) {
      return "#" + el.id;
    }
    if (el.className) {
      return "." + el.className.toString().split(" ").join(".");
    }
    return el.tagName ? el.tagName.toLowerCase() : "cta";
  }

  function isCtaElement(el) {
    if (!el) {
      return false;
    }
    var tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (tag !== "a" && tag !== "button") {
      return false;
    }
    var text = (el.textContent || "").trim();
    if (/\b(start|free|eligib|get started|check)\b/i.test(text)) {
      return true;
    }
    var idClass =
      (el.id || "") + " " + (el.className || "").toString();
    if (/cta|start|eligib|form/i.test(idClass)) {
      return true;
    }
    if (el.hasAttribute("data-cta") || el.hasAttribute("data-ab-slot")) {
      return true;
    }
    return false;
  }

  function initPageView() {
    document.addEventListener(
      "DOMContentLoaded",
      function () {
        var payload = buildBasePayload();
        payload.kind = "page_view";
        scheduleSend(payload, true);
      },
      { passive: true }
    );
  }

  function initHeartbeat() {
    var totalSeconds = 0;
    var lastTick = null;

    function tick() {
      if (document.visibilityState !== "visible") {
        lastTick = null;
        return;
      }
      var now = Date.now();
      if (lastTick === null) {
        lastTick = now;
        return;
      }
      var deltaSec = (now - lastTick) / 1000;
      lastTick = now;
      totalSeconds += deltaSec;
      var payload = buildBasePayload();
      payload.kind = "heartbeat";
      payload.timeOnPageSec = Math.round(totalSeconds);
      scheduleSend(payload, false);
    }

    setInterval(tick, HEARTBEAT_INTERVAL_MS);

    document.addEventListener(
      "visibilitychange",
      function () {
        if (document.visibilityState !== "visible") {
          lastTick = null;
        } else {
          lastTick = Date.now();
        }
      },
      { passive: true }
    );
  }

  function initScrollTracking() {
    var maxScroll = 0;
    var sent = {};
    var timeoutId = null;

    function getScrollPercent() {
      var docEl = document.documentElement;
      var body = document.body;
      var scrollTop = window.pageYOffset || docEl.scrollTop || body.scrollTop || 0;
      var height = Math.max(
        body.scrollHeight,
        docEl.scrollHeight,
        body.offsetHeight,
        docEl.offsetHeight,
        body.clientHeight,
        docEl.clientHeight
      );
      var viewport = window.innerHeight || docEl.clientHeight || 0;
      var totalScrollable = height - viewport;
      if (totalScrollable <= 0) {
        return 100;
      }
      return Math.min(100, Math.round((scrollTop / totalScrollable) * 100));
    }

    function processScroll() {
      var pct = getScrollPercent();
      if (pct > maxScroll) {
        maxScroll = pct;
      }
      SCROLL_THRESHOLDS.forEach(function (threshold) {
        if (maxScroll >= threshold && !sent[threshold]) {
          sent[threshold] = true;
          var payload = buildBasePayload();
          payload.kind = "scroll";
          payload.scrollPct = threshold;
          scheduleSend(payload, false);
        }
      });
    }

    function onScroll() {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(function () {
        processScroll();
      }, 200);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
  }

  function initCtaTracking() {
    var windowStart = Date.now();
    var count = 0;

    function shouldSend() {
      var now = Date.now();
      if (now - windowStart > CTA_RATE_WINDOW_MS) {
        windowStart = now;
        count = 0;
      }
      if (count >= CTA_RATE_LIMIT) {
        return false;
      }
      count += 1;
      return true;
    }

    document.addEventListener(
      "click",
      function (event) {
        var target = event.target;
        if (!target) {
          return;
        }
        var el = target.closest ? target.closest("a, button") : target;
        if (!isCtaElement(el)) {
          return;
        }
        if (!shouldSend()) {
          return;
        }
        var payload = buildBasePayload();
        payload.kind = "cta_click";
        payload.label = getCtaLabel(el);
        scheduleSend(payload, false);
      },
      { passive: true }
    );
  }

  function initFormTracking() {
    document.addEventListener(
      "focusin",
      function (event) {
        var target = event.target;
        if (!target) {
          return;
        }
        var form = target.form || target.closest && target.closest("form");
        if (!isLeadForm(form)) {
          return;
        }
        var flag = safeGetStorage(window.sessionStorage, FORM_START_KEY);
        if (flag) {
          return;
        }
        safeSetStorage(window.sessionStorage, FORM_START_KEY, "1");
        var payload = buildBasePayload();
        payload.kind = "form_start";
        scheduleSend(payload, false);
      },
      { passive: true }
    );

    document.addEventListener(
      "submit",
      function (event) {
        var form = event.target;
        if (!isLeadForm(form)) {
          return;
        }
        var payload = buildBasePayload();
        payload.kind = "form_submit";
        scheduleSend(payload, false);
      },
      { passive: true }
    );
  }

  initPageView();
  initHeartbeat();
  initScrollTracking();
  initCtaTracking();
  initFormTracking();
})();
