import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

console.log('[siphon] main.js: module start');

process.on('uncaughtException', err => {
  console.error('[siphon] uncaughtException:', err);
});
process.on('unhandledRejection', err => {
  console.error('[siphon] unhandledRejection:', err);
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

import { buildTrayMenuTemplate, startApplication } from './appLifecycle.js';
import { FloatingWindowController } from './floatingWindow.js';
import { JsonStore } from './jsonStore.js';
import { PreferencesService } from './preferencesService.js';
import { ProfileService } from './profileService.js';
import { configDir, TokenStore } from './tokenStore.js';
import { ResetNotificationScheduler } from './resetNotificationScheduler.js';
import { createTrayIcon } from './trayIcon.js';
import { UsageController } from './usageController.js';
import { levelForPercent } from '../shared/format.js';
import { t } from '../shared/i18n.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const appIcon = nativeImage.createFromPath(path.join(projectRoot, 'assets', 'installer', 'icon.ico'));

let tray = null;
let window = null;
let floatingWindow = null;
let controller = null;
let preferences = null;
let trayIconLevel = 'ok';

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
  console.error('[siphon] whenReady failed:', error);
});

function onReady() {
  console.log('[siphon] app ready');

  const tokenStore = new TokenStore();
  const profileService = new ProfileService({ tokenStore });
  const resetStore = new JsonStore(path.join(configDir(), 'reset-notification.json'));
  preferences = new PreferencesService(
    new JsonStore(path.join(configDir(), 'preferences.json'))
  );
  const resetScheduler = new ResetNotificationScheduler({
    notify: () => {
      const lang = preferences.get('language') || 'en';
      const notif = new Notification({
        title: t('notification.resetTitle', lang),
        body: t('notification.resetBody', lang),
        silent: false
      });
      notif.on('click', () => showMainWindow());
      notif.show();
      if (preferences.get('notifications.sound')) {
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

  preferences.on('change', ({ path: preferencePath, value }) => {
    if (preferencePath === 'floating.enabled') {
      if (value) {
        openFloatingWidget(controller.getState());
      } else {
        floatingWindow?.hide();
      }
    }
    if (preferencePath === 'claudePath') {
      const effectiveDir = value || path.join(os.homedir(), '.claude');
      controller.updateClaudePath(effectiveDir);
      void controller.refreshLocal();
    }
  });

  void startApplication({
    loadWindow: () => window.loadFile(path.join(projectRoot, 'src', 'renderer', 'index.html')),
    showWindow: showMainWindow,
    startController: () => controller.start(),
    onControllerError: error => {
      console.error('Controller startup failed:', error);
    }
  }).catch(error => {
    console.error('Application startup failed:', error);
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

  window = new BrowserWindow({
    width: 336,
    height: 620,
    minWidth: 336,
    minHeight: 520,
    resizable: true,
    show: false,
    frame: false,
    title: 'Siphon',
    icon: appIcon,
    backgroundColor: '#000000',
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
  trayIconLevel = 'ok';
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Siphon');
  tray.on('double-click', () => showMainWindow());
  updateTray(controller.getState());
}

function updateTray(state) {
  if (!tray) return;
  const session = state.quota?.session?.percent;
  const level = levelForPercent(session ?? 0);

  if (level !== trayIconLevel) {
    tray.setImage(createTrayIcon(level));
    trayIconLevel = level;
  }

  const sessionText = session == null ? '--' : `${Math.round(session)}%`;
  tray.setToolTip(`Siphon - session ${sessionText}`);
  tray.setContextMenu(
    Menu.buildFromTemplate(
      buildTrayMenuTemplate({
        showMainWindow,
        showFloatingWidget: enableFloatingWidget,
        showSettingsWindow,
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
  ipcMain.handle('prefs:set', (_event, { path: preferencePath, value }) => {
    const ALLOWED = new Set([
      'language', 'notifications.sessionReset', 'notifications.sound',
      'floating.enabled', 'floating.x', 'floating.y', 'claudePath'
    ]);
    if (!ALLOWED.has(preferencePath)) return;
    controller.preferences.set(preferencePath, value);
  });
  ipcMain.handle('view:show-main', () => showMainWindow());
  ipcMain.handle('view:show-settings', () => showSettingsWindow());
  ipcMain.handle('floating:open-main', () => showMainWindow());
  ipcMain.handle('floating:close', () => {
    controller.preferences.set('floating.enabled', false);
  });
  ipcMain.handle('app:info', () => ({
    configDir: configDir(),
    claudeDir: preferences.get('claudePath') || path.join(os.homedir(), '.claude'),
    notificationsSupported: Notification.isSupported(),
    version: app.getVersion()
  }));
  ipcMain.handle('dialog:pick-folder', async () => {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      defaultPath: preferences.get('claudePath') || path.join(os.homedir(), '.claude')
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
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;
      shell.openExternal(url);
    } catch { /* invalid URL */ }
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

function enableFloatingWidget() {
  controller.preferences.set('floating.enabled', true);
}

function openFloatingWidget(state = controller?.getState()) {
  if (!floatingWindow || !controller) return;
  void floatingWindow.show(state).catch(error => {
    console.error('Floating widget failed:', error);
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
  window.setIcon(appIcon);
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
