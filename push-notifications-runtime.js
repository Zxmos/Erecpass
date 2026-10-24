/* ERecPass native FCM registration. This file is only injected into the Android APK build. */
(function () {
  'use strict';
  const TAG = '[ERecPass Push]';
  let started = false;
  let token = '';
  let signOutPatched = false;
  function isNativeAndroid() {
    try { return !!window.ERecPassPushNotifications && !!window.Capacitor && typeof window.Capacitor.getPlatform === 'function' && window.Capacitor.getPlatform() === 'android'; } catch (_) { return false; }
  }
  async function getClientAndUser() {
    const client = window.erecpassSupabase;
    if (!client || !client.auth) return null;
    const result = await client.auth.getUser();
    const user = result && result.data && result.data.user;
    return user ? { client, user } : null;
  }
  async function saveToken() {
    if (!token || !isNativeAndroid()) return;
    try {
      const context = await getClientAndUser();
      if (!context) return;
      patchSignOut(context.client);
      const result = await context.client.from('device_push_tokens').upsert({ token, user_id: context.user.id, platform: 'android', updated_at: new Date().toISOString() }, { onConflict: 'token' });
      if (result.error) throw result.error;
      console.info(TAG, 'Device token registered for current account.');
    } catch (error) { console.warn(TAG, 'Could not register device token:', error && error.message ? error.message : error); }
  }
  function patchSignOut(client) {
    if (signOutPatched || !client || !client.auth || typeof client.auth.signOut !== 'function') return;
    const original = client.auth.signOut.bind(client.auth);
    client.auth.signOut = async function () {
      try {
        const auth = await client.auth.getUser();
        const user = auth && auth.data && auth.data.user;
        if (user && token) await client.from('device_push_tokens').delete().eq('token', token).eq('user_id', user.id);
      } catch (error) { console.warn(TAG, 'Could not remove signed-out device token:', error && error.message ? error.message : error); }
      return original.apply(null, arguments);
    };
    signOutPatched = true;
  }
  async function start() {
    if (started || !isNativeAndroid()) return;
    try {
      const context = await getClientAndUser();
      if (!context) return;
      started = true;
      patchSignOut(context.client);
      const plugin = window.ERecPassPushNotifications;
      const permission = await plugin.checkPermissions();
      let receive = permission && permission.receive;
      if (receive !== 'granted') receive = (await plugin.requestPermissions()).receive;
      if (receive !== 'granted') { console.info(TAG, 'Notification permission was not granted.'); return; }
      if (typeof plugin.createChannel === 'function') {
        await plugin.createChannel({ id: 'erecpass-updates', name: 'ERecPass Updates', description: 'Messages and health record updates', importance: 5, sound: 'default', vibration: true });
      }
      await plugin.addListener('registration', async function (result) { token = String(result && result.value || ''); await saveToken(); });
      await plugin.addListener('registrationError', function (error) { console.warn(TAG, 'Firebase token registration failed:', error); });
      await plugin.addListener('pushNotificationReceived', function (notification) { console.info(TAG, 'Push notification received while app is open.', notification && notification.id); });
      await plugin.addListener('pushNotificationActionPerformed', function (action) { window.dispatchEvent(new CustomEvent('erecpass:push-opened', { detail: action || {} })); });
      await plugin.register();
      setTimeout(saveToken, 1500);
    } catch (error) { console.warn(TAG, 'Push registration setup failed:', error && error.message ? error.message : error); }
  }
  window.addEventListener('erecpass:session-ready', function () { if (isNativeAndroid()) start().then(saveToken); });
  window.addEventListener('pageshow', function () { if (isNativeAndroid()) start().then(saveToken); });
  document.addEventListener('DOMContentLoaded', function () { if (isNativeAndroid()) setTimeout(function () { start().then(saveToken); }, 800); });
})();
