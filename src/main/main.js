import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

console.log('[siphon] main.js: module start');

process.on('uncaughtException', err => {
  logSafeError('[siphon] uncaughtException:', err);
});
process.on('unhandledRejection', err => {
  logSafeError('[siphon] unhandledRejection:', err);
});

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen as electronScreen,
  shell,
  Tray
} from 'electron';

console.log('[siphon] electron imported');

import { createAppIcon } from './appIcon.js';
import { buildTrayMenuTemplate, startApplication } from './appLifecycle.js';
import { FloatingWindowController } from './floatingWindow.js';
import { JsonStore } from './jsonStore.js';
import { PreferencesService } from './preferencesService.js';
import { ProfileService } from './profileService.js';
import { configDir, TokenStore } from './tokenStore.js';
import { ResetNotificationScheduler } from './resetNotificationScheduler.js';
import { applyStartupSettings, shouldStartHidden } from './startupService.js';
import { createTrayIcon } from './trayIcon.js';
import { checkForUpdate, downloadFile } from './updateService.js';
import { UsageController } from './usageController.js';
import { ClaudeSettingsService } from './claudeSettingsService.js';
import { levelForPercent } from '../shared/format.js';
import { t } from '../shared/i18n.js';
import { buildTrayStatus } from '../shared/trayStatus.js';
import { logSafeError } from '../shared/diagnostics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const appIcon = createAppIcon(nativeImage, projectRoot);
const launchHidden = shouldStartHidden(process.argv);

let tray = null;
let window = null;
let floatingWindow = null;
let controller = null;
let claudeSettingsService = null;
let preferences = null;
let trayIconKey = 'ok-ok';

app.setAppUserModelId('com.kayodantes.siphon');

console.log('[siphon] requesting single instance lock');
if (!app.requestSingleInstanceLock()) {
  console.log('[siphon] lock failed — quitting');
  app.quit();
  process.exit(0);
}
console.log('[siphon] lock acquired');

app.on('second-instance', () => {
  if (window) showMainWindow();
});

console.log('[siphon] registering whenReady handler');
app.whenReady().then(onReady).catch(error => {
  logSafeError('[siphon] whenReady failed:', error);
});

async function onReady() {
  console.log('[siphon] app ready');

  const tokenStore = new TokenStore();
  const profileService = new ProfileService({ tokenStore });
  const resetStore = new JsonStore(path.join(configDir(), 'reset-notification.json'));
  preferences = new PreferencesService(
    new JsonStore(path.join(configDir(), 'preferences.json'))
  );
  const initialPreferences = await preferences.load();
  claudeSettingsService = new ClaudeSettingsService({ exePath: app.getPath('exe') });
  if (app.isPackaged && initialPreferences.integration?.launchWithClaudeCode) {
    void claudeSettingsService.ensureEnabled().catch(err => {
      logSafeError('[siphon] claude settings sync failed on startup:', err);
    });
  }
  if (app.isPackaged) applyStartupSettings(app, initialPreferences.startup);
  const resetScheduler = new ResetNotificationScheduler({
    notify: async () => {
      const lang = (await preferences.get('language')) || 'en';
      const soundEnabled = await preferences.get('notifications.sound');
      const notif = new Notification({
        title: t('notification.resetTitle', lang),
        body: t('notification.resetBody', lang),
        silent: true
      });
      notif.on('click', () => showMainWindow());
      notif.show();
      if (soundEnabled) {
        window?.webContents.send('play-reset-sound');
      }
    },
    loadState: () => resetStore.load(),
    saveState: state => resetStore.save(state)
  });

  controller = new UsageController({
    preferences,
    profileService,
    tokenStore,
    resetScheduler,
    openExternal: url => shell.openExternal(url)
  });

  floatingWindow = new FloatingWindowController({
    BrowserWindow,
    htmlPath: path.join(projectRoot, 'src', 'renderer', 'floating.html'),
    preloadPath: path.join(__dirname, 'preload.cjs'),
    preferences,
    screen: electronScreen
  });

  console.log('[siphon] creating window');
  createWindow();
  console.log('[siphon] creating tray');
  createTray();
  console.log('[siphon] registering IPC');
  registerIpc();
  console.log('[siphon] setup done');

  controller.on('state', state => {
    window?.webContents.send('state-changed', state);
    syncFloatingWindow(state);
    updateTray(state);
  });

  preferences.on('change', ({ path: preferencePath, value, preferences: nextPreferences }) => {
    if (preferencePath === 'floating.enabled') {
      if (value) {
        openFloatingWidget(controller.getState());
      } else {
        floatingWindow?.hide();
      }
    }
    if (preferencePath === 'floating.expanded') {
      floatingWindow?.applySize(nextPreferences.floating?.style ?? 'classic', Boolean(value));
    }
    if (preferencePath === 'floating.style') {
      if (floatingWindow?.window && !floatingWindow.window.isDestroyed()) {
        floatingWindow.hide();
        setImmediate(() => openFloatingWidget(controller.getState()));
      }
    }
    if (preferencePath === 'claudePath') {
      const effectiveDir = value || path.join(os.homedir(), '.claude');
      controller.updateClaudePath(effectiveDir);
      void controller.refreshLocal().catch(err => logSafeError('[prefs] claudePath refresh failed:', err));
    }
    if (preferencePath.startsWith('startup.')) {
      if (app.isPackaged) applyStartupSettings(app, nextPreferences.startup);
    }
  });

  void startApplication({
    loadWindow: () => window.loadFile(path.join(projectRoot, 'src', 'renderer', 'index.html')),
    showWindow: showMainWindow,
    showOnStart: !launchHidden,
    startController: () => controller.start(),
    onControllerError: error => {
      logSafeError('Controller startup failed:', error);
    }
  }).catch(error => {
    logSafeError('Application startup failed:', error);
  });

  void checkForUpdate().then(update => {
    if (!update || !window) return;
    const send = () => window?.webContents.send('update-available', update);
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', send);
    } else {
      send();
    }
  });
}

app.on('activate', () => {
  showWindow();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  floatingWindow?.hide();
  controller?.stop();
});

function createWindow() {
  Menu.setApplicationMenu(null);

  const { workArea } = electronScreen.getPrimaryDisplay();
  const height = Math.max(600, Math.min(711, Math.round(workArea.height * 0.85)));

  window = new BrowserWindow({
    width: 340,
    height,
    minWidth: 340,
    minHeight: 600,
    resizable: true,
    show: false,
    frame: false,
    hasShadow: false,
    title: 'Siphon',
    icon: appIcon,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.on('close', event => {
    if (!app.isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
}

function createTray() {
  trayIconKey = 'ok-ok';
  tray = new Tray(createTrayIcon('ok', 'ok'));
  tray.setToolTip('Siphon');
  tray.on('double-click', () => showMainWindow());
  tray.setContextMenu(
    Menu.buildFromTemplate(
      buildTrayMenuTemplate({
        showMainWindow,
        showFloatingWidget: enableFloatingWidget,
        showSettingsWindow,
        restart,
        quit
      })
    )
  );
  updateTray(controller.getState());
}

function updateTray(state) {
  if (!tray) return;
  const sessionLevel = levelForPercent(state.quota?.session?.percent ?? 0);
  const weeklyLevel = levelForPercent(state.quota?.weeklyAll?.percent ?? 0);
  const key = `${sessionLevel}-${weeklyLevel}`;
  const lang = state.preferences?.language ?? 'en';
  const trayStatus = buildTrayStatus(state, { lang });

  if (key !== trayIconKey) {
    tray.setImage(createTrayIcon(sessionLevel, weeklyLevel));
    trayIconKey = key;
  }

  tray.setToolTip(trayStatus.tooltip);
  tray.setContextMenu(
    Menu.buildFromTemplate(
      buildTrayMenuTemplate({
        statusItems: trayStatus.menuItems,
        showMainWindow,
        showFloatingWidget: enableFloatingWidget,
        showSettingsWindow,
        restart,
        quit
      })
    )
  );
}

function registerIpc() {
  ipcMain.handle('state:get', () => controller.getState());
  ipcMain.handle('refresh', () => controller.refreshAll());
  ipcMain.handle('auth:start', () => controller.startSignIn());
  ipcMain.handle('auth:submit', (_event, code) => controller.submitCode(code));
  ipcMain.handle('auth:cancel', () => controller.cancelAuth());
  ipcMain.handle('auth:sign-out', () => controller.signOut());
  ipcMain.handle('prefs:get', () => controller.preferences.load());
  ipcMain.handle('prefs:set', async (_event, { path: preferencePath, value }) => {
    const ALLOWED = new Set([
      'language', 'notifications.sessionReset', 'notifications.sound',
      'notifications.soundVolume', 'notifications.expireSound', 'notifications.expireSoundVolume',
      'notifications.limitSound', 'notifications.limitSoundVolume',
      'floating.enabled', 'floating.expanded', 'floating.x', 'floating.y', 'floating.style',
      'startup.openAtLogin', 'startup.showWindowOnLogin',
      'refresh.intervalSeconds',
      'claudePath',
      'integration.launchWithClaudeCode'
    ]);
    if (!ALLOWED.has(preferencePath)) return;
    if (preferencePath === 'refresh.intervalSeconds') {
      const allowedIntervals = new Set([30, 60, 300, 900, 1800]);
      if (!allowedIntervals.has(Number(value))) return;
    }
    if (preferencePath === 'integration.launchWithClaudeCode') {
      if (!app.isPackaged) return;
      if (value) {
        await claudeSettingsService.enable();
      } else {
        await claudeSettingsService.disable();
      }
    }
    if (preferencePath === 'floating.style') {
      if (value !== 'classic' && value !== 'mini') return;
    }
    try {
      await controller.preferences.set(preferencePath, value);
    } catch (err) {
      logSafeError('[prefs:set] write failed:', err);
    }
  });
  ipcMain.handle('view:show-main', () => showMainWindow());
  ipcMain.handle('view:show-settings', () => showSettingsWindow());
  ipcMain.handle('floating:open-main', () => showMainWindow());
  ipcMain.handle('floating:close', async () => {
    await controller.preferences.set('floating.enabled', false);
  });
  ipcMain.handle('floating:set-expanded', async (_event, expanded) => {
    await floatingWindow?.setExpanded(Boolean(expanded));
  });
  ipcMain.handle('app:info', async () => ({
    configDir: configDir(),
    claudeDir: (await preferences.get('claudePath')) || path.join(os.homedir(), '.claude'),
    notificationsSupported: Notification.isSupported(),
    version: app.getVersion(),
    isPackaged: app.isPackaged
  }));
  ipcMain.handle('dialog:pick-folder', async () => {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      defaultPath: (await preferences.get('claudePath')) || path.join(os.homedir(), '.claude')
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('window:minimize', () => window?.minimize());
  ipcMain.handle('window:close', () => {
    if (!app.isQuitting) window?.hide();
  });
  ipcMain.handle('app:quit', () => quit());
  ipcMain.handle('shell:open-external', (_event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return;
      shell.openExternal(url);
    } catch { /* invalid URL */ }
  });

  ipcMain.handle('update:download', async (_event, { downloadUrl, version }) => {
    const destPath = path.join(app.getPath('temp'), `Siphon-Setup-${version}.exe`);
    try {
      await downloadFile(downloadUrl, destPath, percent => {
        window?.webContents.send('update:progress', { percent });
      });
      window?.webContents.send('update:downloaded', { filePath: destPath });
    } catch (err) {
      window?.webContents.send('update:error', { message: err.message });
    }
  });

  ipcMain.handle('update:install', async (_event, filePath) => {
    await shell.openPath(filePath);
  });
}

function showMainWindow() {
  showWindow();
  sendView('main');
}

function showSettingsWindow() {
  showWindow();
  sendView('settings');
}

async function enableFloatingWidget() {
  await controller.preferences.set('floating.enabled', true);
}

function openFloatingWidget(state = controller?.getState()) {
  if (!floatingWindow || !controller) return;
  void floatingWindow.show(state).catch(error => {
    logSafeError('Floating widget failed:', error);
  });
}

function syncFloatingWindow(state) {
  if (!floatingWindow) return;

  if (state.preferences?.floating?.enabled) {
    if (floatingWindow.window) {
      floatingWindow.syncState(state);
    } else {
      openFloatingWidget(state);
    }
    return;
  }

  floatingWindow.hide();
}

function showWindow() {
  if (!window.isVisible()) positionWindow();
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

function sendView(view) {
  if (!window || window.webContents.isLoading()) {
    window?.webContents.once('did-finish-load', () => sendView(view));
    return;
  }
  window.webContents.send('view-changed', view);
}

function quit() {
  app.isQuitting = true;
  app.quit();
}

function restart() {
  app.relaunch();
  app.isQuitting = true;
  app.quit();
}

function positionWindow() {
  if (!tray || !window) return;
  const trayBounds = tray.getBounds();
  const windowBounds = window.getBounds();
  const display = electronScreen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y
  });
  const x = Math.round(display.workArea.x + display.workArea.width - windowBounds.width - 16);
  const y = Math.round(display.workArea.y + display.workArea.height - windowBounds.height - 16);
  window.setPosition(x, y, false);
}
