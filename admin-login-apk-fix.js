/* ERecPass Admin APK login compatibility patch.
 * Keeps the existing UI and enforces the Supabase profile role before entry.
 */
(function () {
  'use strict';

  window.handleAdminLogin = async function (event) {
    if (event) event.preventDefault();

    const user = String(document.getElementById('adminLoginUser')?.value || '').trim().toLowerCase();
    const pass = String(document.getElementById('adminLoginPassword')?.value || '');

    if (!user || !pass) {
      alert('Please enter admin email and password.');
      return;
    }

    // Always authenticate against the configured ERecPass Supabase project.
    // Android WebView may retain a client initialized by an older cached script;
    // replace it only when its URL/key do not match, keeping the UI unchanged.
    const expectedUrl = 'https://bfboehvgrivanmrfqquw.supabase.co';
    const expectedKey = 'sb_publishable_BKQ_gEGu54VUztykzIIfEQ_2IMIoMb_';
    let client = window.erecpassSupabase;
    const clientMatches = () =>
      String(client?.supabaseUrl || '').replace(/\/+$/, '') === expectedUrl &&
      String(client?.supabaseKey || '') === expectedKey;

    if ((!client?.auth || !clientMatches()) &&
        window.supabase && typeof window.supabase.createClient === 'function') {
      client = window.supabase.createClient(expectedUrl, expectedKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      window.erecpassSupabase = client;
      console.info('[ERecPass] Admin login initialized the configured Supabase client.');
    }

    if (!client?.auth || typeof client.auth.signInWithPassword !== 'function' || !clientMatches()) {
      alert('Cannot connect to the secure login service. Check your internet connection, then close and reopen ERecPass. If the issue continues, install the latest APK.');
      console.error('[ERecPass] Supabase client unavailable or configured for the wrong project during Admin login.');
      return;
    }

    try {
      const authResult = await client.auth.signInWithPassword({ email: user, password: pass });
      if (authResult.error) throw authResult.error;

      const authUser = authResult.data?.user;
      if (!authUser?.id) throw new Error('Login succeeded but the account identity could not be verified.');

      const profileResult = await client
        .from('profiles')
        .select('id, role, active, full_name')
        .eq('id', authUser.id)
        .maybeSingle();

      if (profileResult.error) {
        await client.auth.signOut();
        throw new Error('Could not verify Admin permissions. Please check the Supabase profiles access policy and try again.');
      }

      const profile = profileResult.data;
      const role = String(profile?.role || '').trim().toLowerCase();

      if (!profile || role !== 'admin') {
        await client.auth.signOut();
        alert('This account is authenticated but is not assigned the Admin role. Ask the system administrator to verify its role in Supabase.');
        return;
      }

      if (profile.active === false) {
        await client.auth.signOut();
        alert('This Admin account is deactivated. Login is disabled.');
        return;
      }

      currentSession = {
        role: 'admin',
        data: {
          id: authUser.id,
          name: String(profile.full_name || authUser.user_metadata?.full_name || authUser.email || 'Admin'),
          username: String(authUser.email || user),
          email: String(authUser.email || user)
        }
      };

      epStore.setItem(DB_KEYS.SESSION, JSON.stringify(currentSession));
      try { addLog('Admin logged in.'); } catch (logError) { console.warn('[ERecPass] Admin audit log warning:', logError); }
      hideAuthPages();
      launchPortalByRole('admin');
    } catch (error) {
      console.error('[ERecPass] Admin login failed:', error);
      const message = String(error?.message || '');
      if (/invalid login credentials/i.test(message)) {
        alert('Invalid Admin email or password.');
      } else if (/email not confirmed/i.test(message)) {
        alert('Please verify the Admin email address before logging in.');
      } else if (/network|fetch|failed to connect|load failed/i.test(message)) {
        alert('Cannot reach Supabase. Check your internet connection and try again.');
      } else {
        alert(message || 'Admin login failed. Please try again.');
      }
    }
  };
})();

// Rebuild marker: ensure the latest Android APK includes the admin email login fix.
