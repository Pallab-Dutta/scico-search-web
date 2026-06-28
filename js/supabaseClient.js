/* Thin wrapper over supabase-js (loaded as a UMD global `supabase` via a <script> tag).
   Exposes window.SciCoAuth for Google sign-in/out and token access. */
(function () {
  const cfg = window.SCICO_CONFIG || {};
  let client = null;

  function getClient() {
    if (client) return client;
    if (!window.supabase || !cfg.SUPABASE_URL) return null;
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return client;
  }

  window.SciCoAuth = {
    client: getClient,

    async signInWithGoogle() {
      const c = getClient();
      if (!c) throw new Error("Supabase not configured");
      return c.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: cfg.REDIRECT_URL || window.location.origin + "/" },
      });
    },

    async signOut() {
      const c = getClient();
      if (c) await c.auth.signOut();
    },

    async getUser() {
      const c = getClient();
      if (!c) return null;
      const { data } = await c.auth.getUser();
      return data ? data.user : null;
    },

    async getToken() {
      const c = getClient();
      if (!c) return null;
      const { data } = await c.auth.getSession();
      return data && data.session ? data.session.access_token : null;
    },

    // Calls cb(user|null) now and on every auth state change.
    onChange(cb) {
      const c = getClient();
      if (!c) { cb(null); return; }
      c.auth.getUser().then(({ data }) => cb(data ? data.user : null));
      c.auth.onAuthStateChange((_e, session) => cb(session ? session.user : null));
    },
  };
})();
