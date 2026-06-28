/* SciCo-Search frontend configuration.
   Fill these in for your deployment. Safe to expose: the Supabase anon key is public by design
   (RLS protects data); the service-role key lives only on the backend. */
window.SCICO_CONFIG = {
  // Hugging Face Space API base, e.g. "https://your-name-scico-search.hf.space".
  API_BASE: "https://pallab-dutta-1997-scicosearch.hf.space",

  // Supabase project.
  SUPABASE_URL: "https://gjwhhdlocxxycczlsfgy.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdqd2hoZGxvY3h4eWNjemxzZmd5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MTU2NjYsImV4cCI6MjA5ODE5MTY2Nn0.vyj5PZyFZxspFzMqN4vwUjkQQXMk2qXB3zt1BQxs7Rw",

  // Where Google OAuth returns to (must be registered in Supabase → Auth → URL config).
  REDIRECT_URL: "https://search.scicoagent.com/",
};
