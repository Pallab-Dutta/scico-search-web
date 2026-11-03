/* Eratost early-access waitlist.

   - Remembers where a visitor came from: ?ref= / ?utm_source= / ?utm_campaign= on the first page they land
     on (kept for the visit, then sent with the sign-up), so each outreach email can carry its own tag.
   - EratostWaitlist.open({ plan, period, page }) shows the form in a dialog;
     EratostWaitlist.mount(el, { plan, page }) puts it inline (waitlist.html).
   - No sign-in needed. A signed-in user gets their email filled in and is linked to their account.
   Posts to the backend's POST /waitlist (window.SCICO_CONFIG.API_BASE). */
(function () {
  const KEY = "eratost_ref";
  const qs = new URLSearchParams(location.search);
  const ref = { source: qs.get("ref") || qs.get("utm_source") || "", campaign: qs.get("utm_campaign") || "" };
  try {
    if ((ref.source || ref.campaign) && !sessionStorage.getItem(KEY)) sessionStorage.setItem(KEY, JSON.stringify(ref));
  } catch (_) { /* storage blocked: the tag is still sent from this page */ }
  const firstRef = () => {
    try { return JSON.parse(sessionStorage.getItem(KEY) || "null") || ref; } catch (_) { return ref; }
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  const PLANS = [["pro", "Pro: more deep searches and Gap Graphs"], ["max", "Max: unlimited, plus the research-plan generator"],
                 ["team", "Team: for a lab or group"], ["unsure", "Not sure yet"]];
  const ROLES = [["", "Choose one"], ["student", "PhD / Master's student"], ["postdoc", "Postdoc"], ["faculty", "Faculty / PI"],
                 ["industry", "Industry researcher"], ["other", "Other"]];

  const CSS = `
.ewl-back{position:fixed;inset:0;z-index:1000;background:rgba(30,42,49,.42);display:flex;align-items:center;justify-content:center;padding:16px}
.ewl-card{background:#fffdf9;border:1px solid #dcd5c7;border-radius:16px;box-shadow:0 24px 60px -24px rgba(30,42,49,.5);
  width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:26px 26px 22px;position:relative;color:#1e2a31}
.ewl-x{position:absolute;top:10px;right:12px;border:0;background:none;font-size:22px;cursor:pointer;color:#5e6a71;line-height:1}
.ewl h3{font-family:"Cutive Mono",monospace;font-size:1.35rem;margin:0 0 .3rem}
.ewl p.ewl-sub{font-family:"Lora",Georgia,serif;font-weight:400;color:#5e6a71;margin:0 0 1.1rem;font-size:.95rem;line-height:1.5}
.ewl form{display:flex;flex-direction:column;gap:.75rem}
.ewl label{display:flex;flex-direction:column;gap:.3rem;font-family:"Cutive Mono",monospace;font-weight:700;font-size:.85rem}
.ewl label .opt{font-weight:400;color:#8a949a}
.ewl input,.ewl select{font:400 .95rem "Lora",Georgia,serif;padding:.62rem .75rem;border:1px solid #dcd5c7;border-radius:10px;background:#fff;color:#1e2a31;width:100%}
.ewl input:focus,.ewl select:focus{outline:none;border-color:#ba5757;box-shadow:0 0 0 3px rgba(186,87,87,.15)}
.ewl .ewl-row{display:flex;gap:.75rem}.ewl .ewl-row>label{flex:1;min-width:0}
.ewl .ewl-period{display:flex;gap:1rem;font-family:"Lora",Georgia,serif;font-weight:400;font-size:.92rem}
.ewl .ewl-period label{flex-direction:row;align-items:center;gap:.35rem;font:400 .92rem "Lora",Georgia,serif;white-space:nowrap}
.ewl input[type=radio]{width:auto;accent-color:#ba5757}
.ewl .ewl-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.ewl button.ewl-go{margin-top:.35rem;font-family:"Cutive Mono",monospace;font-weight:700;font-size:1rem;border:0;border-radius:999px;
  padding:.85rem 1.4rem;background:#f3dcd9;color:#9c4343;cursor:pointer;transition:background .15s,color .15s}
.ewl button.ewl-go:hover{background:#dfe5e8;color:#1e2a31}.ewl button.ewl-go:disabled{opacity:.6;cursor:wait}
.ewl .ewl-err{color:#9c4343;font:400 .9rem "Lora",Georgia,serif;min-height:1.2em}
.ewl .ewl-fine{font:400 .8rem "Lora",Georgia,serif;color:#8a949a;margin-top:.2rem}
.ewl .ewl-done{text-align:center;padding:.6rem 0 .2rem}
.ewl .ewl-done .big{font-family:"Cutive Mono",monospace;font-size:1.4rem;margin:.4rem 0}
.ewl .ewl-done p{font:400 .95rem "Lora",Georgia,serif;color:#5e6a71;line-height:1.55}
@media(max-width:520px){.ewl .ewl-row{flex-direction:column}}`;
  let cssDone = false;
  const css = () => { if (cssDone) return; cssDone = true; const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); };

  function formHTML(o) {
    const opts = (list, v) => list.map(([k, t]) => `<option value="${k}"${k === v ? " selected" : ""}>${esc(t)}</option>`).join("");
    return `<div class="ewl">
  <h3>${esc(o.title || "Join the early-access list")}</h3>
  <p class="ewl-sub">${esc(o.subtitle || "Search and topic maps are free today. Paid plans open soon: join the list and we will email you first, with an early-member price.")}</p>
  <form novalidate>
    <label>Email<input type="email" name="email" required autocomplete="email" placeholder="you@university.edu"/></label>
    <div class="ewl-row">
      <label><span>Name <span class="opt">(optional)</span></span><input type="text" name="name" autocomplete="name" maxlength="120"/></label>
      <label>You are<select name="role">${opts(ROLES, "")}</select></label>
    </div>
    <label><span>Research area <span class="opt">(optional)</span></span><input type="text" name="field" maxlength="200" placeholder="e.g. extreme climate events, protein design"/></label>
    <label>Plan you are interested in<select name="plan">${opts(PLANS, o.plan || "pro")}</select></label>
    <label class="ewl-team" style="display:${o.plan === "team" ? "flex" : "none"}"><span>Group size <span class="opt">(optional)</span></span><input type="number" name="team_size" min="1" max="10000" placeholder="e.g. 6"/></label>
    <div class="ewl-period" role="radiogroup" aria-label="Billing preference">
      <label><input type="radio" name="period" value="annual"${o.period === "monthly" ? "" : " checked"}/> Billed yearly</label>
      <label><input type="radio" name="period" value="monthly"${o.period === "monthly" ? " checked" : ""}/> Billed monthly</label>
    </div>
    <div class="ewl-hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"/></label></div>
    <div class="ewl-err" aria-live="polite"></div>
    <button type="submit" class="ewl-go">Join the waitlist</button>
    <div class="ewl-fine">No payment now. We only email you about Eratost early access. By joining you agree to the <a href="https://scicoagent.com/terms/" style="text-decoration:underline">Terms</a> and <a href="https://scicoagent.com/privacy/" style="text-decoration:underline">Privacy Policy</a>.</div>
  </form>
</div>`;
  }

  async function wire(root, o, done) {
    const f = root.querySelector("form"), err = root.querySelector(".ewl-err"), go = root.querySelector(".ewl-go");
    const plan = f.elements.plan, team = root.querySelector(".ewl-team");
    plan.addEventListener("change", () => { team.style.display = plan.value === "team" ? "flex" : "none"; });
    let token = null;
    try {
      if (window.SciCoAuth) {
        const u = await window.SciCoAuth.getUser();
        if (u && u.email && !f.elements.email.value) f.elements.email.value = u.email;
        if (u) { const md = u.user_metadata || {}; if (!f.elements.name.value) f.elements.name.value = md.full_name || md.name || ""; }
        token = await window.SciCoAuth.getToken();
      }
    } catch (_) { /* signed out: the form works without it */ }
    f.addEventListener("submit", async e => {
      e.preventDefault();
      const email = f.elements.email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { err.textContent = "Please enter a valid email address."; f.elements.email.focus(); return; }
      err.textContent = "";
      go.disabled = true; go.textContent = "Joining…";
      const r = firstRef();
      let tz = "";
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (_) {}
      const body = {
        email, name: f.elements.name.value.trim(), role: f.elements.role.value, field: f.elements.field.value.trim(),
        plan: plan.value, period: (f.querySelector('input[name="period"]:checked') || {}).value || "",
        team_size: plan.value === "team" && f.elements.team_size.value ? +f.elements.team_size.value : null,
        source: r.source || "", campaign: r.campaign || "", page: o.page || "", timezone: tz, website: f.elements.website.value,
      };
      try {
        const base = ((window.SCICO_CONFIG || {}).API_BASE || "").replace(/\/$/, "");
        const h = { "Content-Type": "application/json" };
        if (token) h.Authorization = "Bearer " + token;
        const res = await fetch(base + "/waitlist", { method: "POST", headers: h, body: JSON.stringify(body) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((data.detail && data.detail.error) || "Something went wrong. Please try again.");
        root.querySelector(".ewl").innerHTML = `<div class="ewl-done">
          <div style="font-size:2rem">✓</div>
          <div class="big">${data.new === false ? "You are already on the list" : "You are on the list" + (data.position ? ` (#${data.position})` : "")}</div>
          <p>We will email <b>${esc(email)}</b> as soon as ${plan.value === "unsure" ? "paid plans open" : "the " + esc(plan.value[0].toUpperCase() + plan.value.slice(1)) + " plan opens"}, with an early-member price.
          Meanwhile, search and topic maps are free to use.</p>
          <p style="margin-top:.9rem"><a href="search.html" class="ewl-open" style="text-decoration:underline;color:#9c4343">Open Eratost →</a></p></div>`;
        const open = root.querySelector(".ewl-open");
        if (open && window.SciCoAuth && !token) open.addEventListener("click", ev => { ev.preventDefault(); window.SciCoAuth.signInWithGoogle(); });
        if (done) done(data);
      } catch (ex) {
        err.textContent = ex.message || "Something went wrong. Please try again.";
        go.disabled = false; go.textContent = "Join the waitlist";
      }
    });
  }

  window.EratostWaitlist = {
    open(o) {
      o = o || {};
      css();
      const back = document.createElement("div");
      back.className = "ewl-back";
      back.innerHTML = `<div class="ewl-card" role="dialog" aria-modal="true" aria-label="Join the waitlist"><button class="ewl-x" aria-label="Close">×</button>${formHTML(o)}</div>`;
      document.body.appendChild(back);
      const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
      const onKey = e => { if (e.key === "Escape") close(); };
      document.addEventListener("keydown", onKey);
      back.addEventListener("click", e => { if (e.target === back) close(); });
      back.querySelector(".ewl-x").addEventListener("click", close);
      wire(back, o);
      setTimeout(() => { const i = back.querySelector('input[name="email"]'); if (i && !i.value) i.focus(); }, 50);
      return { close };
    },
    mount(el, o) {
      o = o || {};
      css();
      el.innerHTML = formHTML(o);
      wire(el, o);
    },
    ref: firstRef,
  };
})();
