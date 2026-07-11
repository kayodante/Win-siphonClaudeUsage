// Siphon IPC bridge for the Tauri backend.
//
// This is the ONLY new file the renderer needs for the Rust/Tauri migration. It
// re-creates the exact `window.siphon.*` surface that `preload.cjs` used to
// expose over Electron's contextBridge, but implemented on top of Tauri's global
// API (`window.__TAURI__`, available because `withGlobalTauri` is enabled). Every
// other renderer file — renderer.js, floating.js, styles.css, the shared/*.js
// modules — is untouched.
//
// Loaded as a classic (non-module) script BEFORE renderer.js / floating.js so
// `window.siphon` exists before those modules run.
(() => {
  const tauri = window.__TAURI__;
  if (!tauri) {
    console.error('[siphon] Tauri global API not found');
    return;
  }
  const { invoke } = tauri.core;
  const { listen } = tauri.event;

  // Wrap Tauri's async `listen` (returns Promise<UnlistenFn>) as the synchronous
  // unsubscribe function the renderer expects from the old `ipcRenderer.on`.
  const on = (event, callback) => {
    const pending = listen(event, e => callback(e.payload));
    return () => {
      pending.then(unlisten => unlisten()).catch(() => {});
    };
  };

  window.siphon = {
    getState: () => invoke('state_get'),
    refresh: () => invoke('refresh'),
    startSignIn: () => invoke('auth_start'),
    submitCode: code => invoke('auth_submit', { code }),
    cancelAuth: () => invoke('auth_cancel'),
    signOut: () => invoke('auth_sign_out'),
    getPreferences: () => invoke('prefs_get'),
    setPreference: (path, value) => invoke('prefs_set', { args: { path, value } }),
    showMainView: () => invoke('view_show_main'),
    showSettingsView: () => invoke('view_show_settings'),
    openMainWindowFromWidget: () => invoke('floating_open_main'),
    closeFloatingWidget: () => invoke('floating_close'),
    setFloatingExpanded: expanded => invoke('floating_set_expanded', { expanded }),
    getAppInfo: () => invoke('app_info'),
    minimize: () => invoke('window_minimize'),
    closeWindow: () => invoke('window_close'),
    quit: () => invoke('app_quit'),
    openExternal: url => invoke('shell_open_external', { url }),
    pickFolder: () => invoke('dialog_pick_folder'),
    downloadUpdate: payload => invoke('update_download', { payload }),
    installUpdate: () => invoke('update_install'),
    installViaWinget: () => invoke('update_install_via_winget'),

    onView: callback => on('view-changed', callback),
    onState: callback => on('state-changed', callback),
    onResetSound: callback => on('play-reset-sound', () => callback()),
    onUpdateAvailable: callback => on('update-available', callback),
    onUpdateProgress: callback => on('update:progress', callback),
    onUpdateDownloaded: callback => on('update:downloaded', callback),
    onUpdateError: callback => on('update:error', callback)
  };
})();
