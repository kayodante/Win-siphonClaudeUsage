// fallow-ignore-file unused-file -- loaded via webPreferences.preload string path (main.js), not a JS import
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
  setFloatingExpanded: expanded => ipcRenderer.invoke('floating:set-expanded', expanded),
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
  },
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  onResetSound: callback => {
    const listener = () => callback();
    ipcRenderer.on('play-reset-sound', listener);
    return () => ipcRenderer.removeListener('play-reset-sound', listener);
  },
  onUpdateAvailable: callback => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('update-available', listener);
    return () => ipcRenderer.removeListener('update-available', listener);
  },
  downloadUpdate: payload => ipcRenderer.invoke('update:download', payload),
  installUpdate: filePath => ipcRenderer.invoke('update:install', filePath),
  installViaWinget: () => ipcRenderer.invoke('update:installViaWinget'),
  onUpdateProgress: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('update:progress', listener);
    return () => ipcRenderer.removeListener('update:progress', listener);
  },
  onUpdateDownloaded: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('update:downloaded', listener);
    return () => ipcRenderer.removeListener('update:downloaded', listener);
  },
  onUpdateError: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('update:error', listener);
    return () => ipcRenderer.removeListener('update:error', listener);
  }
});
