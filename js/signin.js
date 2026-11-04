/* Eratost sign-in, as Benjamin's: one window from every Sign in button, "Continue with Google" (the usual
   Google redirect) or "Continue with email" (no password: a one-time link AND a code by email; the code is
   for when the email is opened on another device or a mail filter breaks the link).

   Load in <head> (no dependencies): clicks are caught from the start, so a Sign in pressed before the
   sign-in library has loaded opens the window at once and finishes when the library is ready.
   Buttons: .js-signin, .js-signin-open, .js-open (any of them). A signed-in visitor goes to the app.
   Also: the full-screen "Signing you in via Google" screen (window.__signinWait), sign-in step counting
   (window.SciCoSigninSteps -> /client/signin-step, shown in admin.html) and failure reports
   (window.SciCoSigninReport -> /client/signin-error, sent to the team's chat). Never throws. */
(function () {
  "use strict";
  var APP = "search.html", RESEND_SECONDS = 60;
  var cfg = function () { return window.SCICO_CONFIG || {}; };
  var base = function () { return (cfg().API_BASE || "").replace(/\/$/, ""); };
  var store = function (k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  var load = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var page = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  /* ---------------- failure reports ---------------- */
  function post(path, body) {
    try {
      if (!base()) return;
      fetch(base() + path, { method: "POST", headers: { "Content-Type": "text/plain" },   // no CORS preflight
        body: JSON.stringify(body), keepalive: true }).catch(function () {});
    } catch (e) {}
  }
  function report(stage, message, extra) {
    var b = { stage: stage, message: String(message || "").slice(0, 300), page: page };
    if (extra && extra.email) b.email = String(extra.email).slice(0, 120);
    post("/client/signin-error", b);
  }
  window.SciCoSigninReport = report;

  /* ---------------- step counting ---------------- */
  var vid = load("eratost_vid");
  if (!vid) { vid = "v" + Math.random().toString(36).slice(2) + Date.now().toString(36); store("eratost_vid", vid); }
  var VIA = "eratost_signin_via", VIA_MAX = 3600e3;
  function signedInHere() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (/^sb-.*-auth-token$/.test(k) && localStorage.getItem(k)) return true;
      }
    } catch (e) {}
    return false;
  }
  function fromOutreach() {
    try {
      var r = JSON.parse(sessionStorage.getItem("eratost_ref") || "null");
      return !!(r && (r.report || /outreach/.test(r.source || ""))) || page === "report.html";
    } catch (e) { return page === "report.html"; }
  }
  function step(name, detail, extra) {
    var b = { step: name, vid: vid, detail: detail || "", outreach: fromOutreach() };
    if (extra && extra.new_user) b.new_user = true;
    post("/client/signin-step", b);
  }
  function setVia(m) { store(VIA, JSON.stringify({ m: m, at: Date.now() })); }
  var landed = false;
  function signedIn(user) {             // a session appeared: count it only if this browser started a sign-in
    try {
      if (landed) return;
      var via = null;
      try { via = JSON.parse(load(VIA) || "null"); } catch (e) {}
      if (via && Date.now() - (via.at || 0) > VIA_MAX) via = null;
      if (!via && !window.__hadAuthCode) return;
      landed = true;
      store(VIA, null);
      var made = user && user.created_at ? Date.parse(user.created_at) : NaN;
      step("signed_in", via ? via.m : "other", { new_user: !isNaN(made) && Date.now() - made < VIA_MAX });
    } catch (e) {}
  }
  window.SciCoSigninSteps = { step: step, setVia: setVia, signedIn: signedIn, signedInHere: signedInHere };

  // Back from Google or an email link: with an error, report it; with a code but no session, report that.
  try {
    var q = new URLSearchParams(location.search), h = new URLSearchParams(location.hash.replace(/^#/, ""));
    window.__hadAuthCode = q.has("code") || h.has("access_token");
    var err = q.get("error") || h.get("error");
    if (err) report("oauth_return", err + (q.get("error_code") || h.get("error_code") ? " / " + (q.get("error_code") || h.get("error_code")) : "") +
                    ": " + (q.get("error_description") || h.get("error_description") || ""));
  } catch (e) {}

  /* ---------------- the library may still be loading ---------------- */
  function ready() { return !!(window.SciCoAuth && window.supabase && window.SciCoAuth.client && window.SciCoAuth.client()); }
  function whenReady(ms) {
    return new Promise(function (res, rej) {
      if (ready()) return res();
      var t0 = Date.now(), iv = setInterval(function () {
        if (ready()) { clearInterval(iv); res(); }
        else if (Date.now() - t0 > ms) { clearInterval(iv); report("library", "sign-in library still not loaded " + Math.round(ms / 1000) + " s after the click"); rej(new Error("library")); }
      }, 150);
    });
  }
  if (window.__hadAuthCode) {          // came back with a code: did a session come of it?
    setTimeout(function () {
      whenReady(15000).then(function () { return window.SciCoAuth.getUser(); }).then(function (u) {
        if (!u) report("code_exchange", "came back from sign-in, but no session after 12 s");
      }).catch(function () {});
    }, 12000);
  }

  /* ---------------- styles ---------------- */
  var css = "" +
  ".esi{position:fixed;inset:0;margin:auto;height:fit-content;max-height:calc(100vh - 32px);overflow:auto;border:1px solid #dcd5c7;border-radius:16px;padding:0;" +
  "max-width:min(420px,calc(100vw - 32px));width:100%;background:#fffdf9;color:#1e2a31;box-shadow:0 18px 50px -20px rgba(30,42,49,.45)}" +
  ".esi::backdrop{background:rgba(30,42,49,.38)}" +
  ".esi__body{padding:26px 24px 22px;position:relative;text-align:left}" +
  ".esi__brand{display:flex;flex-direction:column;align-items:center;gap:.25rem;margin:2px 0 10px}" +
  ".esi__brand .m{width:52px;height:52px}.esi__brand .m svg{width:100%;height:100%}" +
  ".esi__brand .w{font:700 1.35rem 'Cutive Mono',monospace;letter-spacing:.02em}" +
  ".esi h2{font:700 1.2rem 'Cutive Mono',monospace;margin:0 0 4px;text-align:center}" +
  ".esi p{font:400 .95rem/1.5 'Lora',Georgia,serif;margin:0 0 14px;color:#5e6a71}" +
  ".esi .esi__lead{text-align:center;margin-bottom:18px}" +
  ".esi label{display:block;font:700 .85rem 'Cutive Mono',monospace;margin:0 0 6px}" +
  ".esi input{width:100%;box-sizing:border-box;font:400 1rem 'Lora',Georgia,serif;padding:10px 12px;border-radius:10px;border:1px solid #dcd5c7;background:#fff;color:inherit;margin:0 0 12px}" +
  ".esi input:focus{outline:2px solid #ba5757;outline-offset:1px}" +
  ".esi input.esi__code{letter-spacing:.35em;font-family:'Cutive Mono',monospace;text-align:center;font-size:1.3rem}" +
  ".esi__btn{display:flex;width:100%;align-items:center;justify-content:center;gap:10px;min-height:46px;padding:10px 16px;border-radius:999px;" +
  "font:600 .98rem/1.2 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;cursor:pointer;box-sizing:border-box}" +
  ".esi__google{background:#fff;color:#1f1f1f;border:1px solid #c9c2b3}.esi__google:hover{background:#f7f4ee;border-color:#9a9284}" +
  ".esi__email{background:#f3dcd9;color:#9c4343;border:1px solid #f3dcd9}.esi__email:hover{background:#ecc9c4}" +
  ".esi__btn:focus-visible{outline:2px solid #ba5757;outline-offset:2px}.esi__btn[disabled]{opacity:.6;cursor:default}" +
  ".esi__or{display:flex;align-items:center;gap:12px;margin:16px 0 14px;color:#5e6a71;font:400 .85rem 'Cutive Mono',monospace}" +
  ".esi__or::before,.esi__or::after{content:'';flex:1;height:1px;background:#dcd5c7}" +
  ".esi__row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-top:10px}" +
  ".esi__link{background:none;border:0;padding:0;font:400 .85rem 'Lora',Georgia,serif;color:#9c4343;text-decoration:underline;cursor:pointer}" +
  ".esi__link[disabled]{color:#8a949a;text-decoration:none;cursor:default}" +
  ".esi__msg{min-height:1.2em;font:400 .85rem 'Lora',Georgia,serif;margin:8px 0 0}" +
  ".esi .esi__msg--err{color:#9c4343}.esi .esi__msg--ok{color:#2f7a33}" +
  ".esi .esi__fine{font-size:.8rem;line-height:1.45;margin:10px 0 0;text-align:center}.esi .esi__fine a{color:#9c4343}" +
  ".esi__close{position:absolute;z-index:2;top:8px;right:12px;padding:4px 8px;background:none;border:0;font-size:1.5rem;line-height:1;cursor:pointer;color:#5e6a71}" +
  ".signin-wait{position:fixed;inset:0;z-index:10000;display:none;align-items:center;justify-content:center;flex-direction:column;gap:.4rem;background:rgba(247,244,238,.97);text-align:center;padding:16px}" +
  ".signin-wait.on{display:flex}" +
  ".signin-wait__site{font:600 .9rem 'Cutive Mono',monospace;color:#5e6a71;letter-spacing:.02em}";
  function addCss() {
    if (document.getElementById("esi-css")) return;
    var st = document.createElement("style");
    st.id = "esi-css"; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }
  addCss();

  /* ---------------- "Signing you in via Google" ---------------- */
  function waitScreen(on) {
    var el = document.getElementById("signinWait");
    if (!el && on) {
      el = document.createElement("div");
      el.id = "signinWait"; el.className = "signin-wait"; el.setAttribute("role", "status");
      el.innerHTML = (window.EratostLoader ? window.EratostLoader.block("Signing you in via Google", { gradient: true }) : "Signing you in via Google") +
        '<div class="signin-wait__site">eratost.scicoagent.com</div>';
      document.body.appendChild(el);
    }
    if (el) el.classList.toggle("on", !!on);
  }
  window.__signinWait = waitScreen;
  window.addEventListener("pageshow", function (e) { if (e.persisted) waitScreen(false); });   // Back from Google

  /* ---------------- the window ---------------- */
  var dlg = null, email = "", timer = null;
  var G = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  function el(html) { var t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; }
  function build() {
    addCss();
    var mark = window.EratostLoader && window.EratostLoader.mark ? window.EratostLoader.mark() : "";
    dlg = el('<dialog class="esi" aria-labelledby="esi-title">' +
      '<button class="esi__close" type="button" aria-label="Close">×</button><div class="esi__body">' +
      '<form class="esi__step esi__step--email" novalidate>' +
        '<div class="esi__brand"><span class="m">' + mark + '</span><span class="w"><span style="color:#1e2a31">Eratost</span><span style="color:#d1d1d1">henes</span></span></div>' +
        '<h2 id="esi-title">Sign in to Eratost</h2>' +
        '<p class="esi__lead">Search and topic maps are free. No card needed.</p>' +
        '<button class="esi__btn esi__google" type="button">' + G + 'Continue with Google</button>' +
        '<div class="esi__or"><span>or</span></div>' +
        '<label for="esi-email">Email address</label>' +
        '<input id="esi-email" type="email" autocomplete="email" required placeholder="you@university.edu">' +
        '<button class="esi__btn esi__email" type="submit">Continue with email</button>' +
        '<p class="esi__msg" role="status"></p>' +
        '<p class="esi__fine">With email there is no password: we send you a sign-in link and a code. Already use Google with Eratost? Use that same address to keep your searches.</p>' +
        '<p class="esi__fine">By continuing you agree to the <a href="https://scicoagent.com/terms/">Terms</a> and <a href="https://scicoagent.com/privacy/">Privacy Policy</a>.</p>' +
      '</form>' +
      '<form class="esi__step esi__step--code" hidden>' +
        '<h2>Check your inbox</h2>' +
        '<p>We sent a sign-in link to <strong class="esi__to"></strong>. Click it on this device, or enter the code from the email here. Not there? Check spam or promotions.</p>' +
        '<label for="esi-code">Code</label>' +
        '<input id="esi-code" class="esi__code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" maxlength="10" required placeholder="123456">' +
        '<button class="esi__btn esi__email" type="submit">Sign in</button>' +
        '<div class="esi__row"><button class="esi__link esi__resend" type="button" disabled>Resend</button><button class="esi__link esi__other" type="button">Use a different email</button></div>' +
        '<p class="esi__msg" role="status"></p>' +
      '</form></div></dialog>');
    document.body.appendChild(dlg);
    var fE = dlg.querySelector(".esi__step--email"), fC = dlg.querySelector(".esi__step--code");
    dlg.querySelector(".esi__close").addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    fE.addEventListener("submit", function (e) { e.preventDefault(); send(fE, fC, false); });
    fC.addEventListener("submit", function (e) { e.preventDefault(); verify(fC); });
    dlg.querySelector(".esi__resend").addEventListener("click", function () { send(fE, fC, true); });
    dlg.querySelector(".esi__other").addEventListener("click", function () { show(fE, fC, "email"); });
    dlg.querySelector(".esi__google").addEventListener("click", google);
  }
  function msg(f, t, kind) { var m = f.querySelector(".esi__msg"); m.textContent = t || ""; m.className = "esi__msg" + (kind ? " esi__msg--" + kind : ""); }
  function busy(f, on) { f.querySelectorAll("button,input").forEach(function (x) { if (!x.classList.contains("esi__resend")) x.disabled = on; }); }
  function show(fE, fC, which) {
    fE.hidden = which !== "email"; fC.hidden = which !== "code";
    msg(fE, ""); msg(fC, "");
    (which === "email" ? fE : fC).querySelector("input").focus();
  }
  function resendTimer() {
    var b = dlg.querySelector(".esi__resend"), left = RESEND_SECONDS;
    clearInterval(timer); b.disabled = true; b.textContent = "Resend in " + left + "s";
    timer = setInterval(function () {
      left -= 1;
      if (left <= 0) { clearInterval(timer); b.disabled = false; b.textContent = "Resend"; return; }
      b.textContent = "Resend in " + left + "s";
    }, 1000);
  }
  function friendly(err) {
    var t = String((err && (err.message || err.msg)) || "");
    if (/library/.test(t)) return "The page has not finished loading. Please check your connection and try again.";
    if (/rate|too many|security purposes/i.test(t)) return "Too many requests: please wait a minute and try again.";
    if (/invalid.*email|email.*invalid/i.test(t)) return "Please enter a valid email address.";
    if (/expired|invalid|token/i.test(t)) return "That code is wrong or has expired: request a new one.";
    return "Something went wrong. Please try again, or write to contact@scicoagent.com.";
  }
  function send(fE, fC, again) {
    var input = fE.querySelector("input");
    if (!again) email = input.value.trim().toLowerCase();
    if (!email || !input.checkValidity()) { msg(fE, "Please enter a valid email address.", "err"); return; }
    if (!again) step("email_click");
    var f = again ? fC : fE;
    busy(f, true); msg(f, again ? "Sending a new link…" : "Sending…");
    whenReady(20000).then(function () { return window.SciCoAuth.signInWithEmail(email); }).then(function () {
      dlg.querySelector(".esi__to").textContent = email;
      if (!again) show(fE, fC, "code");
      msg(fC, again ? "A new link and code are on the way." : "", "ok");
      resendTimer();
    }).catch(function (err) {
      msg(f, friendly(err), "err");
      report("email_send", (err && (err.message || err.msg)) || String(err), { email: email });
    }).then(function () { busy(f, false); });
  }
  function verify(fC) {
    var code = fC.querySelector("input").value.replace(/\D/g, "");
    if (code.length < 6) { msg(fC, "Enter the code from the email.", "err"); return; }
    busy(fC, true); msg(fC, "Signing in…");
    step("code_entered");
    whenReady(20000).then(function () { return window.SciCoAuth.verifyEmailCode(email, code); }).then(function () {
      msg(fC, "Signed in. Opening Eratost…", "ok");
      location.href = APP;
    }).catch(function (err) {
      msg(fC, friendly(err), "err"); busy(fC, false);
      report("email_code", (err && (err.message || err.msg)) || String(err), { email: email });
    });
  }
  function google() {                    // the usual Google redirect, behind the "Signing you in" screen
    if (dlg && dlg.open) dlg.close();
    step("google_click"); setVia("google");
    waitScreen(true);
    whenReady(25000).then(function () { return window.SciCoAuth.getUser(); }).then(function (u) {
      if (u) { location.href = APP; return; }
      return window.SciCoAuth.signInWithGoogle();
    }).catch(function (err) {
      report(ready() ? "google_start" : "library", (err && err.message) || String(err));
      waitScreen(false);
      open();                            // back to the choice, to try again
    });
  }
  function open() {
    if (!dlg) build();
    var fE = dlg.querySelector(".esi__step--email"), fC = dlg.querySelector(".esi__step--code");
    if (!dlg.open) { if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", ""); }
    show(fE, fC, "email");
    dlg.querySelector(".esi__google").focus();   // not the email box: on phones that pops up the keyboard
  }
  window.SciCoSignIn = { open: open, google: google };

  // Every sign-in button on the page: signed in -> the app; signed out -> the window.
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest(".js-signin, .js-signin-open, .js-open");
    if (!t || (dlg && dlg.contains(t))) return;
    e.preventDefault(); e.stopPropagation();
    if (!signedInHere()) { step("window_open"); open(); return; }
    whenReady(15000).then(function () { return window.SciCoAuth.getUser(); }).then(function (u) {
      if (u) location.href = APP; else { step("window_open"); open(); }
    }).catch(function () { open(); });
  }, true);

  // A signed-out visitor on a public page.
  if (!signedInHere() && /^(index\.html|pricing\.html|waitlist\.html|report\.html)$/.test(page)) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { step("page"); });
    else step("page");
  }
})();
