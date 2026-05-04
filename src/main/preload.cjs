const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('siphon', {
  getState: () => ipcRenderer.invoke('state:get'),
  refresh: () => ipcRenderer.invoke('refresh'),
  startSignIn: () => ipcRenderer.invoke('auth:start'),
  submitCode: code => ipcRenderer.invoke('auth:submit', code),
  cancelAuth: () => ipcRenderer.invoke('auth:cancel'),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  getPreferences: () => ipcRenderer.invoke('prefs:get'),
  setPreference: (path, value) => ipcRenderer.invoke('prefs:set', { path, value }),
  showMainView: () => ipcRenderer.invoke('view:show-main'),
  showSettingsView: () => ipcRenderer.invoke('view:show-settings'),
  openMainWindowFromWidget: () => ipcRenderer.invoke('floating:open-main'),
  closeFloatingWidget: () => ipcRenderer.invoke('floating:close'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  quit: () => ipcRenderer.invoke('app:quit'),
  openExternal: url => ipcRenderer.invoke('shell:open-external', url),
  onView: callback => {
    const listener = (_event, view) => callback(view);
    ipcRenderer.on('view-changed', listener);
    return () => ipcRenderer.removeListener('view-changed', listener);
  },
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state-changed', listener);
    return () => ipcRenderer.removeListener('state-changed', listener);
  }
});
