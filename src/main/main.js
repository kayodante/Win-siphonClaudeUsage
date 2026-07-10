import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

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
import { UsageAlertService } from './usageAlerts.js';
import { checkForUpdate, downloadFile, wingetUpgrade } from './updateService.js';
import { ALLOWED_REFRESH_INTERVALS, UsageController } from './usageController.js';
import { ClaudeSettingsService } from './claudeSettingsService.js';
import { isSafeExternalUrl } from './security.js';
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
let windowHasSavedPosition = false;
let windowBoundsSaveTimer = null;
let preferences = null;
let trayIconKey = 'ok-ok';

let pendingInstallPath = null;
let usageAlertService = null;

app.setAppUserModelId('com.kayodantes.siphon');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (window) showMainWindow();
});

// Re-assert widget z-order whenever any window gains focus (Windows drops topmost on focus switch)
app.on('browser-window-focus', () => {
  floatingWindow?.reAssertAlwaysOnTop();
});

app.whenReady().then(onReady).catch(error => {
  logSafeError('[siphon] whenReady failed:', error);
});

async function onReady() {
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
      showNotification(t('notification.resetTitle', lang), t('notification.resetBody', lang));
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

  usageAlertService = new UsageAlertService({ showNotification });
  floatingWindow = new FloatingWindowController({
    BrowserWindow,
    htmlPath: path.join(projectRoot, 'src', 'renderer', 'floating.html'),
    preloadPath: path.join(__dirname, 'preload.cjs'),
    preferences,
    screen: electronScreen
  });

  createWindow(initialPreferences.window);
  createTray();
  registerIpc();

  controller.on('state', state => {
    window?.webContents.send('state-changed', state);
    syncFloatingWindow(state);
    updateTray(state);
    void usageAlertService.checkUsageAlerts(state).catch(err => logSafeError('[alerts] checkUsageAlerts failed:', err));
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
      void (async () => {
        const effectiveDir = value || await controller.preferences.getClaudePath();
        controller.updateClaudePath(effectiveDir);
        void controller.refreshLocal().catch(err => logSafeError('[prefs] claudePath refresh failed:', err));
      })();
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

app.on('before-quit', () => {
  app.isQuitting = true;
  floatingWindow?.hide();
  controller?.stop();
});

function fitsOnAnyDisplay(bounds) {
  return electronScreen.getAllDisplays().some(d => {
    const b = d.bounds;
    return (
      bounds.x >= b.x &&
      bounds.y >= b.y &&
      bounds.x + bounds.width <= b.x + b.width &&
      bounds.y + bounds.height <= b.y + b.height
    );
  });
}

function createWindow(savedBounds) {
  Menu.setApplicationMenu(null);

  const { workArea } = electronScreen.getPrimaryDisplay();
  const defaultHeight = Math.max(600, Math.min(711, Math.round(workArea.height * 0.85)));
  const defaultWidth = 320;

  windowHasSavedPosition = Boolean(
    savedBounds &&
    Number.isFinite(savedBounds.x) &&
    Number.isFinite(savedBounds.y) &&
    Number.isFinite(savedBounds.width) &&
    Number.isFinite(savedBounds.height) &&
    fitsOnAnyDisplay(savedBounds)
  );

  window = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    minWidth: 310,
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

  if (windowHasSavedPosition) {
    window.once('ready-to-show', () => {
      window.setPosition(savedBounds.x, savedBounds.y, false);
      setImmediate(() => {
        if (window && !window.isDestroyed()) {
          window.setSize(savedBounds.width, savedBounds.height, false);
        }
      });
    });
  }

  window.on('close', event => {
    if (!app.isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });

  window.on('move', scheduleWindowBoundsSave);
  window.on('resize', scheduleWindowBoundsSave);
}

function scheduleWindowBoundsSave() {
  if (!window || window.isDestroyed()) return;
  if (windowBoundsSaveTimer) clearTimeout(windowBoundsSaveTimer);
  windowBoundsSaveTimer = setTimeout(() => {
    windowBoundsSaveTimer = null;
    void saveWindowBounds();
  }, 500);
}

async function saveWindowBounds() {
  if (!window || window.isDestroyed() || !controller) return;
  const { x, y, width, height } = window.getBounds();
  windowHasSavedPosition = true;
  await controller.preferences.setMany([
    ['window.x', x],
    ['window.y', y],
    ['window.width', width],
    ['window.height', height]
  ]);
}

function createTray() {
  trayIconKey = 'ok-ok';
  tray = new Tray(createTrayIcon('ok', 'ok'));
  tray.setToolTip('Siphon');
  tray.on('double-click', () => showMainWindow());
  tray.setContextMenu(
    Menu.buildFromTemplate(
      buildTrayMenuTemplate({
        floatingWidgetEnabled: Boolean(controller.getState().preferences?.floating?.enabled),
        showMainWindow,
        toggleFloatingWidget,
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
        floatingWidgetEnabled: Boolean(state.preferences?.floating?.enabled),
        statusItems: trayStatus.menuItems,
        showMainWindow,
        toggleFloatingWidget,
        showSettingsWindow,
        restart,
        quit
      })
    )
  );
}


function showNotification(title, body) {
  const notif = new Notification({ title, body, silent: true });
  notif.on('click', () => showMainWindow());
  notif.show();
}

function registerIpc() {
  registerStateIpc();
  registerPrefsIpc();
  registerWindowIpc();
  registerUpdateIpc();
}

function registerStateIpc() {
  ipcMain.handle('state:get', () => controller.getState());
  ipcMain.handle('refresh', () => controller.refreshAll());
  ipcMain.handle('auth:start', () => controller.startSignIn());
  ipcMain.handle('auth:submit', (_event, code) => controller.submitCode(code));
  ipcMain.handle('auth:cancel', () => controller.cancelAuth());
  ipcMain.handle('auth:sign-out', () => controller.signOut());
  ipcMain.handle('app:info', async () => ({
    configDir: configDir(),
    claudeDir: await preferences.getClaudePath(),
    notificationsSupported: Notification.isSupported(),
    version: app.getVersion(),
    isPackaged: app.isPackaged
  }));
}

function registerPrefsIpc() {
  ipcMain.handle('prefs:get', () => controller.preferences.load());
  ipcMain.handle('prefs:set', async (_event, { path: preferencePath, value }) => {
    const ALLOWED = new Set([
      'language', 'notifications.sessionReset', 'notifications.sound',
      'notifications.soundVolume', 'notifications.expireSound', 'notifications.expireSoundVolume',
      'notifications.expireAlert',
      'notifications.limitSound', 'notifications.limitSoundVolume',
      'notifications.limitAlert',
      'floating.enabled', 'floating.expanded', 'floating.x', 'floating.y', 'floating.style',
      'startup.openAtLogin', 'startup.showWindowOnLogin',
      'refresh.intervalSeconds',
      'claudePath',
      'integration.launchWithClaudeCode',
      'privacy.maskEmail',
      'display.quotaMode'
    ]);
    if (!ALLOWED.has(preferencePath)) return;
    if (preferencePath === 'refresh.intervalSeconds') {
      if (!ALLOWED_REFRESH_INTERVALS.has(Number(value))) return;
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
    if (preferencePath === 'display.quotaMode') {
      if (value !== 'used' && value !== 'remaining') return;
    }
    try {
      await controller.preferences.set(preferencePath, value);
    } catch (err) {
      logSafeError('[prefs:set] write failed:', err);
    }
  });
  ipcMain.handle('dialog:pick-folder', async () => {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      defaultPath: await preferences.getClaudePath()
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}

function registerWindowIpc() {
  ipcMain.handle('view:show-main', () => showMainWindow());
  ipcMain.handle('view:show-settings', () => showSettingsWindow());
  ipcMain.handle('floating:open-main', () => showMainWindow());
  ipcMain.handle('floating:close', async () => {
    await controller.preferences.set('floating.enabled', false);
  });
  ipcMain.handle('floating:set-expanded', async (_event, expanded) => {
    await floatingWindow?.setExpanded(Boolean(expanded));
  });
  ipcMain.handle('window:minimize', () => window?.minimize());
  ipcMain.handle('window:close', () => {
    if (!app.isQuitting) window?.hide();
  });
  ipcMain.handle('app:quit', () => quit());
  ipcMain.handle('shell:open-external', (_event, url) => {
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url);
    }
  });
}

function registerUpdateIpc() {
  ipcMain.handle('update:download', async (_event, { downloadUrl, checksumUrl, version }) => {
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      window?.webContents.send('update:error', { message: 'invalid version' });
      return;
    }
    let parsedUrl;
    let parsedChecksumUrl;
    try {
      parsedUrl = new URL(downloadUrl);
      if (checksumUrl) parsedChecksumUrl = new URL(checksumUrl);
    } catch {
      window?.webContents.send('update:error', { message: 'invalid URL' });
      return;
    }
    const TRUSTED_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com', 'release-assets.githubusercontent.com']);
    const isTrustedHost = url => url && url.protocol === 'https:' && TRUSTED_HOSTS.has(url.hostname);
    if (!isTrustedHost(parsedUrl) || (parsedChecksumUrl && !isTrustedHost(parsedChecksumUrl))) {
      window?.webContents.send('update:error', { message: 'untrusted download URL' });
      return;
    }
    const tempDir = app.getPath('temp');
    const destPath = path.resolve(tempDir, `Siphon-Setup-${version}.exe`);
    const expectedPrefix = tempDir.endsWith(path.sep) ? tempDir : tempDir + path.sep;
    if (!destPath.startsWith(expectedPrefix)) {
      window?.webContents.send('update:error', { message: 'invalid destination path' });
      return;
    }

    const effectiveChecksumUrl = checksumUrl || (downloadUrl + '.sha256');
    const checksumPath = destPath + '.sha256';

    try {
      await downloadFile(downloadUrl, destPath, percent => {
        window?.webContents.send('update:progress', { percent });
      }, undefined, TRUSTED_HOSTS);

      await downloadFile(effectiveChecksumUrl, checksumPath, undefined, undefined, TRUSTED_HOSTS);

      const checksumText = (await fs.promises.readFile(checksumPath, 'utf8')).trim();
      const expectedHash = checksumText.split(' ')[0];

      const actualHash = await new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = fs.createReadStream(destPath);
        stream.on('data', data => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', err => reject(err));
      });

      if (actualHash !== expectedHash) {
        throw new Error('Checksum verification failed');
      }

      pendingInstallPath = destPath;
      window?.webContents.send('update:downloaded', { filePath: destPath });
    } catch (err) {
      await fs.promises.unlink(destPath).catch(() => {});
      window?.webContents.send('update:error', { message: err.message });
    } finally {
      await fs.promises.unlink(checksumPath).catch(() => {});
    }
  });

  ipcMain.handle('update:install', async () => {
    if (!pendingInstallPath) return;
    const pathToOpen = pendingInstallPath;
    pendingInstallPath = null;

    const tempDir = app.getPath('temp');
    const expectedPrefix = tempDir.endsWith(path.sep) ? tempDir : tempDir + path.sep;
    const isExpectedInstaller = pathToOpen.startsWith(expectedPrefix)
      && /^Siphon-Setup-\d+\.\d+\.\d+\.exe$/.test(path.basename(pathToOpen));
    if (!isExpectedInstaller) {
      window?.webContents.send('update:error', { message: 'invalid installer path' });
      return;
    }
    try {
      await fs.promises.access(pathToOpen, fs.constants.X_OK);
    } catch {
      window?.webContents.send('update:error', { message: 'installer not found' });
      return;
    }

    spawn(pathToOpen, [], { detached: true, stdio: 'ignore' }).unref();
  });

  ipcMain.handle('update:installViaWinget', async () => {
    // Helper waits for this process to exit, upgrades, then relaunches Siphon.
    wingetUpgrade({ pid: process.pid, execPath: process.execPath });
    app.isQuitting = true;
    app.quit();
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

async function toggleFloatingWidget() {
  const enabled = Boolean(controller.getState().preferences?.floating?.enabled);
  await controller.preferences.set('floating.enabled', !enabled);
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
  if (!window || window.isDestroyed()) return;
  if (!window.isVisible() && !windowHasSavedPosition) positionWindow();
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

function sendView(view) {
  if (!window || window.isDestroyed()) return;
  const contents = window.webContents;
  if (contents.isLoading()) {
    contents.once('did-finish-load', () => sendView(view));
    return;
  }
  contents.send('view-changed', view);
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
