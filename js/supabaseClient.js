/* Thin wrapper over supabase-js (loaded as a UMD global `supabase` via a <script> tag).
   Exposes window.SciCoAuth for Google and email sign-in, sign-out and token access. */
(function () {
  const cfg = window.SCICO_CONFIG || {};
  let client = null;

  function getClient() {
    if (client) return client;
    if (!window.supabase || !cfg.SUPABASE_URL) return null;
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    try {   // sign-in step counting (js/signin.js); only reads the session, never changes it
      client.auth.onAuthStateChange(function (_e, session) {
        if (session && session.user && window.SciCoSigninSteps) window.SciCoSigninSteps.signedIn(session.user);
      });
    } catch (e) {}
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

    // Email sign-in, no password: Supabase emails a one-time link AND a code (the "Magic Link" email
    // template must include {{ .Token }} for the code). The same address as a Google account signs in to
    // that same account (Supabase links identities with the same verified email).
    async signInWithEmail(email) {
      const c = getClient();
      if (!c) throw new Error("Supabase not configured");
      const { error } = await c.auth.signInWithOtp({
        email: email,
        options: { emailRedirectTo: cfg.REDIRECT_URL || window.location.origin + "/", shouldCreateUser: true },
      });
      if (error) throw error;
      if (window.SciCoSigninSteps) { window.SciCoSigninSteps.step("email_sent"); window.SciCoSigninSteps.setVia("email"); }
    },

    async verifyEmailCode(email, code) {
      const c = getClient();
      if (!c) throw new Error("Supabase not configured");
      const { data, error } = await c.auth.verifyOtp({ email: email, token: code, type: "email" });
      if (error) throw error;
      return data;
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
