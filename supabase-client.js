/* ERecPass Supabase browser client
 * Use only the Supabase publishable key (or legacy anon key) here.
 * NEVER put a service_role/secret key in browser code.
 */
(function () {
  const SUPABASE_URL = "https://bfboehvgrivanmrfqquw.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_BKQ_gEGu54VUztykzIIfEQ_2IMIoMb_";

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.error("ERecPass: Supabase JS v2 was not loaded before supabase-client.js.");
    return;
  }
  if (!SUPABASE_PUBLISHABLE_KEY || SUPABASE_PUBLISHABLE_KEY.includes("PASTE_YOUR_")) {
    console.warn("ERecPass: Add the Supabase publishable key in supabase-client.js before using cloud features.");
    return;
  }

  // Reuse the client created by the legacy inline bootstrap when present.
  // Two independent Supabase clients can split auth/session state in the APK.
  if (!window.erecpassSupabase || typeof window.erecpassSupabase.auth?.signInWithPassword !== "function") {
    window.erecpassSupabase = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );
  }

  // Initialize password recovery after the Supabase client exists.
  if (typeof window.epInitPasswordRecoveryListener === "function") {
    window.epInitPasswordRecoveryListener();
  }
})();
