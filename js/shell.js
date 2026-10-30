/* Shared sidebar shell, laid out like Benjamin's: logo, profile, Log Out, Pricing & Plans, a rule,
   the star rating (with an optional comment), the New search button, then Eratosthenes' own list
   of past sessions. Handles collapse (Streamlit-style, persisted) and guards app pages behind auth.
   Pages provide <aside class="sidebar" id="sidebar"></aside> and a <button class="sb-expand" id="sbExpand">. */
(function () {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  const loading = label => (window.EratostLoader ? EratostLoader.inline({ gradient: true }) + " " : "") + esc(label);

  function sidebarHTML() {
    return `
      <div class="sb-top">
        <a class="sb-logo" href="search.html" aria-label="Eratosthenes: new search">
          <span class="sb-mark">${window.EratostLoader ? EratostLoader.mark() : ""}</span>
          <span class="scico-logo">Eratosthenes</span>
        </a>
        <button class="sb-toggle" id="sbToggle" title="Hide sidebar"><span class="mi">chevron_left</span></button>
      </div>

      <div class="sb-profile">
        <span class="sb-avatar" id="sbAvatar">?</span>
        <div class="sb-id">
          <div class="sb-name" id="sbName">…</div>
          <div class="sb-email" id="sbEmail"></div>
        </div>
      </div>

      <button class="sb-logout" id="sbLogout"><span class="mi">logout</span> Log Out</button>

      <a class="sb-logout sb-plans" href="pricing.html"><span class="mi">workspace_premium</span> Pricing &amp; Plans</a>

      <hr class="sb-rule"/>

      <div class="sb-rate">
        <p class="side-h"><span class="mi">star</span> Rate Eratosthenes</p>
        <div class="stars" id="sbStars">
          ${[1, 2, 3, 4, 5].map(i => `<span class="mi" data-star="${i}" title="${i} star${i > 1 ? "s" : ""}">star</span>`).join("")}
        </div>
        <div class="sb-feedback" id="sbFeedback" style="display:none">
          <textarea id="sbComment" placeholder="Optional: what do you love? What's missing?" rows="3"></textarea>
          <button id="sbSubmitReview">Submit Review</button>
        </div>
        <div class="sb-thanks" id="sbReviewThanks" style="display:none">Thank you for the review! ✓</div>
      </div>

      <button class="sb-newbtn" onclick="location.href='search.html'"><span class="mi">add</span> New Search</button>

      <div class="sb-hist">
        <p class="side-h"><span class="mi">history</span> Past sessions</p>
        <div id="sessionList"><div class="sb-loading">${loading("Loading sessions…")}</div></div>
      </div>`;
  }

  const Shell = {
    activeSession: null,
    _stars: 0,

    async init(activeSessionId) {
      Shell.activeSession = activeSessionId || null;
      const host = document.getElementById("sidebar");
      if (!host) return;
      host.innerHTML = sidebarHTML();
      if (window.SciCoLogo) window.SciCoLogo.renderAll(host);  // the Eratost|henes wordmark

      // Collapse state (persisted, like the Streamlit sidebar).
      if (localStorage.getItem("sb_collapsed") === "1") document.body.classList.add("sb-collapsed");
      const toggle = () => {
        const collapsed = document.body.classList.toggle("sb-collapsed");
        localStorage.setItem("sb_collapsed", collapsed ? "1" : "0");
      };
      document.getElementById("sbToggle").addEventListener("click", toggle);
      const exp = document.getElementById("sbExpand");
      if (exp) exp.addEventListener("click", toggle);

      document.getElementById("sbLogout").addEventListener("click", async () => {
        try { await window.SciCoAuth.signOut(); } catch (_) {}
        location.href = "index.html";
      });

      Shell.initRating();

      // Auth guard + profile fill.
      window.SciCoAuth.onChange((user) => {
        if (!user) { location.href = "index.html"; return; }
        const md = user.user_metadata || {};
        const name = md.full_name || md.name || (user.email || "").split("@")[0];
        document.getElementById("sbName").textContent = name;
        document.getElementById("sbEmail").textContent = user.email || "";
        const url = md.avatar_url || md.picture;
        const av = document.getElementById("sbAvatar");
        if (url) av.outerHTML = `<img class="sb-avatar" id="sbAvatar" src="${esc(url)}" alt=""/>`;
        else av.textContent = (name || user.email || "?").trim().charAt(0).toUpperCase() || "?";
        Shell.loadSessions();
      });
    },

    // Star rating, as in Benjamin: pick stars, optionally add a comment, submit.
    initRating() {
      const starsEl = document.getElementById("sbStars");
      const feedbackEl = document.getElementById("sbFeedback");
      const thanksEl = document.getElementById("sbReviewThanks");
      const paint = n => starsEl.querySelectorAll(".mi").forEach((s, i) => {
        s.classList.toggle("lit", i < n);
        s.classList.toggle("fill", i < n);
      });
      starsEl.querySelectorAll(".mi").forEach(starEl => {
        starEl.addEventListener("click", () => {
          Shell._stars = +starEl.dataset.star;
          paint(Shell._stars);
          thanksEl.style.display = "none";
          feedbackEl.style.display = "flex";
        });
        starEl.addEventListener("mouseenter", () => paint(+starEl.dataset.star));
        starEl.addEventListener("mouseleave", () => paint(Shell._stars));
      });
      document.getElementById("sbSubmitReview").addEventListener("click", async (e) => {
        if (!Shell._stars) return;
        const btn = e.currentTarget;
        btn.disabled = true;
        const comment = document.getElementById("sbComment").value.trim();
        try { await window.SciCoAPI.feedback(Shell._stars, comment); } catch (_) {}
        btn.disabled = false;
        feedbackEl.style.display = "none";
        thanksEl.style.display = "block";
      });
    },

    async loadSessions() {
      const host = document.getElementById("sessionList");
      if (!host) return;
      try {
        const { sessions } = await window.SciCoAPI.listSessions();
        host.innerHTML = (sessions || []).map(s => {
          const active = s.id === Shell.activeSession ? " active" : "";
          const label = esc(s.base_query || "(untitled)");
          return `<div class="session-row">` +
            `<a class="session${active}" href="results.html?session=${encodeURIComponent(s.id)}">${label}</a>` +
            `<button class="session-del" type="button" data-id="${esc(s.id)}" title="Delete this session" aria-label="Delete session"><span class="mi">delete</span></button>` +
          `</div>`;
        }).join("") || '<small class="sb-empty">No past searches yet.</small>';
        host.querySelectorAll(".session-del").forEach(btn => {
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            Shell.deleteSession(e.currentTarget.getAttribute("data-id"));
          });
        });
        // Opening a past session: show the loader on that row until the page changes.
        host.querySelectorAll("a.session").forEach(a => {
          a.addEventListener("click", () => {
            if (a.classList.contains("active")) return;
            a.innerHTML = loading(a.textContent);
            a.classList.add("opening");
          });
        });
      } catch (_) {
        host.innerHTML = '<small class="sb-empty">Could not load past sessions.</small>';
      }
    },

    async deleteSession(id) {
      if (!id) return;
      if (!window.confirm("Delete this search session? This can't be undone.")) return;
      const row = document.querySelector(`.session-del[data-id="${CSS.escape(id)}"]`);
      if (row) row.closest(".session-row").classList.add("deleting");
      try {
        await window.SciCoAPI.deleteSession(id);
      } catch (_) { /* a reload below will reflect the true server state either way */ }
      // If the deleted session is the one on screen, its content is gone — start fresh.
      if (id === Shell.activeSession) { location.href = "search.html"; return; }
      Shell.loadSessions();
    },
  };

  window.Shell = Shell;
})();
