const WIDGET_WIDTH = 220;
const WIDGET_MARGIN = 20;

export class FloatingWindowController {
  constructor({
    BrowserWindow,
    clearTimeout: clearTimeoutFn = clearTimeout,
    debounceMs = 250,
    htmlPath,
    preferences,
    preloadPath,
    screen = null,
    setTimeout: setTimeoutFn = setTimeout
  }) {
    this.BrowserWindow = BrowserWindow;
    this.clearTimeout = clearTimeoutFn;
    this.debounceMs = debounceMs;
    this.htmlPath = htmlPath;
    this.preferences = preferences;
    this.preloadPath = preloadPath;
    this.screen = screen;
    this.setTimeout = setTimeoutFn;
    this.moveTimer = null;
    this.window = null;
    this.loaded = false;
    this.pendingState = null;
  }

  async show(state) {
    this.pendingState = state ?? this.pendingState;

    if (!this.window || this.window.isDestroyed()) {
      this.createWindow();
      await this.window.loadFile(this.htmlPath);
      this.loaded = true;
      this.syncState(this.pendingState);
    }

    this.showWindow();
  }

  hide() {
    if (this.moveTimer) {
      this.clearTimeout(this.moveTimer);
      this.moveTimer = null;
      this.savePosition();
    }

    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }

    this.window = null;
    this.loaded = false;
  }

  syncState(state) {
    if (!state) return;
    this.pendingState = state;

    if (!this.window || this.window.isDestroyed() || !this.loaded) return;
    this.window.webContents.send('state-changed', state);
  }

  createWindow() {
    this.loaded = false;
    this.window = new this.BrowserWindow({
      width: 220,
      height: 80,
      minWidth: 220,
      minHeight: 80,
      maxWidth: 220,
      maxHeight: 80,
      resizable: false,
      movable: true,
      frame: false,
      transparent: true,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      title: 'Siphon Widget',
      backgroundColor: '#00000000',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.restorePosition();
    this.window.on('move', () => this.schedulePositionSave());
    this.window.on('closed', () => {
      this.window = null;
      this.loaded = false;
    });
  }

  restorePosition() {
    const x = this.preferences.get('floating.x');
    const y = this.preferences.get('floating.y');
    if (Number.isFinite(x) && Number.isFinite(y) && this.isOnAnyDisplay(x, y)) {
      this.window.setPosition(x, y, false);
    } else if (this.screen) {
      this.positionTopRight();
    }
  }

  isOnAnyDisplay(x, y) {
    if (!this.screen) return true;
    return this.screen.getAllDisplays().some(d => {
      const b = d.bounds;
      return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height;
    });
  }

  positionTopRight() {
    const { workArea } = this.screen.getPrimaryDisplay();
    this.window.setPosition(
      workArea.x + workArea.width - WIDGET_WIDTH - WIDGET_MARGIN,
      workArea.y + WIDGET_MARGIN,
      false
    );
  }

  schedulePositionSave() {
    if (!this.window || this.window.isDestroyed()) return;

    if (this.moveTimer) {
      this.clearTimeout(this.moveTimer);
    }

    this.moveTimer = this.setTimeout(() => {
      this.moveTimer = null;
      this.savePosition();
    }, this.debounceMs);
  }

  savePosition() {
    if (!this.window || this.window.isDestroyed()) return;
    const { x, y } = this.window.getBounds();
    this.preferences.set('floating.x', x);
    this.preferences.set('floating.y', y);
  }

  showWindow() {
    if (!this.window || this.window.isDestroyed()) return;

    if (typeof this.window.showInactive === 'function') {
      this.window.showInactive();
      return;
    }

    this.window.show();
  }
}
