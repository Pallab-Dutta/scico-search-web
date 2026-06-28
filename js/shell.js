/* Shared sidebar shell: renders the persistent sidebar (profile, logout, rating, history),
   handles collapse (Streamlit-style, persisted), and guards app pages behind auth.
   Pages provide <aside class="sidebar" id="sidebar"></aside> and a <button class="sb-expand" id="sbExpand">. */
(function () {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));

  function sidebarHTML() {
    return `
      <div class="sb-top">
        <a class="logo" href="search.html" style="font-size:1.05rem"><span class="sci">SciCo</span><span class="badge">Search</span><span class="sup">[1‑3,✓]</span></a>
        <button class="sb-toggle" id="sbToggle" title="Hide sidebar"><span class="mi">chevron_left</span></button>
      </div>

      <div class="sb-profile">
        <span class="sb-avatar" id="sbAvatar">?</span>
        <div class="sb-id">
          <div class="sb-name" id="sbName">…</div>
          <div class="sb-email" id="sbEmail"></div>
        </div>
      </div>

      <button class="sb-logout" id="sbLogout"><span class="mi">logout</span> Log out</button>

      <div class="sb-rate">
        <p class="side-h"><span class="mi">star</span> Rate SciCo-Search</p>
        <div class="stars" id="sbStars">${'<span class="mi fill">star</span>'.repeat(5)}</div>
      </div>

      <button class="sb-newbtn" onclick="location.href='search.html'"><span class="mi">add</span> New search</button>

      <div class="sb-hist">
        <p class="side-h"><span class="mi">history</span> Past sessions</p>
        <div id="sessionList"></div>
      </div>`;
  }

  const Shell = {
    activeSession: null,

    async init(activeSessionId) {
      Shell.activeSession = activeSessionId || null;
      const host = document.getElementById("sidebar");
      if (!host) return;
      host.innerHTML = sidebarHTML();

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

    async loadSessions() {
      const host = document.getElementById("sessionList");
      if (!host) return;
      try {
        const { sessions } = await window.SciCoAPI.listSessions();
        host.innerHTML = (sessions || []).map(s => {
          const active = s.id === Shell.activeSession ? " active" : "";
          return `<a class="session${active}" href="results.html?session=${encodeURIComponent(s.id)}">${esc(s.base_query || "(untitled)")}</a>`;
        }).join("") || '<small style="color:var(--muted)">No past searches yet.</small>';
      } catch (_) { /* sidebar history is best-effort */ }
    },
  };

  window.Shell = Shell;
})();
