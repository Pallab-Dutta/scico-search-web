/* SciCo-Search API client. All calls attach the Supabase JWT as a bearer token.
   SSE is consumed via fetch + a streaming reader (not EventSource) so we can send the
   Authorization header the backend requires. Exposes window.SciCoAPI. */
(function () {
  const cfg = window.SCICO_CONFIG || {};
  const BASE = (cfg.API_BASE || "").replace(/\/$/, "");

  async function authHeaders() {
    const token = window.SciCoAuth ? await window.SciCoAuth.getToken() : null;
    const h = { "Content-Type": "application/json" };
    if (token) h["Authorization"] = "Bearer " + token;
    return h;
  }

  async function req(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: await authHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw { code: 401, message: "Please sign in." };
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok) {
      const detail = data && data.detail ? data.detail : { error: "request_failed" };
      throw { code: res.status, detail, message: (detail && detail.error) || res.statusText };
    }
    return data;
  }

  window.SciCoAPI = {
    me() { return req("GET", "/me"); },
    search(query, opts) {
      opts = opts || {};
      return req("POST", "/search", {
        query,
        depth: opts.depth || "shallow",
        creativity: opts.creativity != null ? opts.creativity : 0.3,
        num_queries: opts.num_queries || 4,
      });
    },
    cite(paper) {
      return req("POST", "/cite", {
        title: paper.title || "",
        display_authors: paper.authors || paper.display_authors || "",
        author_name: paper.author_name || "",
        year: String(paper.year == null ? "" : paper.year),
        link: paper.link || "",
      });
    },
    getSession(id) { return req("GET", "/sessions/" + encodeURIComponent(id)); },
    listSessions() { return req("GET", "/sessions"); },
    profileAuthors(id) { return req("POST", "/sessions/" + encodeURIComponent(id) + "/authors"); },
    expand(id) { return req("POST", "/sessions/" + encodeURIComponent(id) + "/expand"); },

    /* Stream a job's SSE events. handlers: {onEvent(type,data), onError(err)} */
    async streamJob(jobId, handlers) {
      handlers = handlers || {};
      const res = await fetch(BASE + "/jobs/" + encodeURIComponent(jobId) + "/stream", {
        method: "GET",
        headers: await authHeaders(),
      });
      if (!res.ok || !res.body) {
        if (handlers.onError) handlers.onError({ code: res.status });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop(); // keep partial frame
        for (const frame of frames) {
          let evt = "message", payload = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) evt = line.slice(6).trim();
            else if (line.startsWith("data:")) payload += line.slice(5).trim();
          }
          if (!payload) continue; // comments / keepalives
          let data = {};
          try { data = JSON.parse(payload); } catch (_) {}
          if (handlers.onEvent) handlers.onEvent(evt, data);
          if (evt === "done" || evt === "error") return data;
        }
      }
    },
  };
})();
