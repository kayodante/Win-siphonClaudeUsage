import { logSafeError } from '../shared/diagnostics.js';

const MINI_SIZE     = Object.freeze({ width: 71,  height: 32  });
const COMPACT_SIZE  = Object.freeze({ width: 220, height: 104 });
const EXPANDED_SIZE = Object.freeze({ width: 220, height: 192 });
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
      try {
        this.createWindow();
        await this.restorePosition();
        await this.window.loadFile(this.htmlPath);
        this.loaded = true;
        this.syncState(this.pendingState);
      } catch (error) {
        this.destroyWindow();
        throw error;
      }
    }

    this.showWindow();
  }

  hide() {
    if (this.moveTimer) {
      this.clearTimeout(this.moveTimer);
      this.moveTimer = null;
      this.persistPosition();
    }

    this.destroyWindow();
  }

  syncState(state) {
    if (!state) return;
    this.pendingState = state;

    if (!this.window || this.window.isDestroyed() || !this.loaded) return;
    const style = styleOfState(state);
    this.applyAppearance(style);
    this.applySize(style, isExpandedState(state));
    this.window.webContents.send('state-changed', state);
  }

  async setExpanded(expanded) {
    const nextExpanded = Boolean(expanded);
    await this.preferences.set('floating.expanded', nextExpanded);
    if (this.pendingState?.preferences?.floating) {
      this.pendingState.preferences.floating.expanded = nextExpanded;
    }
    this.applySize(styleOfState(this.pendingState), nextExpanded);
  }

  createWindow() {
    this.loaded = false;
    const style = styleOfState(this.pendingState);
    const size = widgetSize(style, isExpandedState(this.pendingState));
    this.window = new this.BrowserWindow({
      width: size.width,
      height: size.height,
      minWidth: size.width,
      minHeight: size.height,
      maxWidth: size.width,
      maxHeight: size.height,
      resizable: false,
      movable: true,
      frame: false,
      thickFrame: false,
      transparent: true,
      useContentSize: true,
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      title: 'Siphon Widget',
      ...appearanceOptions(style),
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.window.on('move', () => this.schedulePositionSave());
    this.window.on('closed', () => {
      this.window = null;
      this.loaded = false;
    });
    // Windows can drop z-order on focus change; re-assert on blur
    this.window.on('blur', () => this.reAssertAlwaysOnTop());
  }

  reAssertAlwaysOnTop() {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.setAlwaysOnTop(true, 'floating');
  }

  async restorePosition() {
    const x = await this.preferences.get('floating.x');
    const y = await this.preferences.get('floating.y');
    if (Number.isFinite(x) && Number.isFinite(y) && this.fitsOnAnyDisplay(x, y)) {
      this.window.setPosition(x, y, false);
    } else if (this.screen) {
      this.positionTopRight();
    }
  }

  fitsOnAnyDisplay(x, y) {
    if (!this.screen) return true;
    const { width, height } = this.window.getBounds();
    return this.screen.getAllDisplays().some(d => {
      const b = d.bounds;
      return (
        x >= b.x &&
        y >= b.y &&
        x + width <= b.x + b.width &&
        y + height <= b.y + b.height
      );
    });
  }

  positionTopRight() {
    const { workArea } = this.screen.getPrimaryDisplay();
    const { width } = this.window.getBounds();
    this.window.setPosition(
      workArea.x + workArea.width - width - WIDGET_MARGIN,
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
      this.persistPosition();
    }, this.debounceMs);
  }

  persistPosition() {
    void this.savePosition().catch(error => {
      logSafeError('Floating widget position save failed:', error);
    });
  }

  async savePosition() {
    if (!this.window || this.window.isDestroyed()) return;
    const { x, y } = this.window.getBounds();
    await this.preferences.set('floating.x', x);
    await this.preferences.set('floating.y', y);
  }

  showWindow() {
    if (!this.window || this.window.isDestroyed()) return;

    if (typeof this.window.showInactive === 'function') {
      this.window.showInactive();
    } else {
      this.window.show();
    }

    this.window.setAlwaysOnTop(true, 'floating');
  }

  applySize(style, expanded) {
    if (!this.window || this.window.isDestroyed()) return;
    const size = widgetSize(style, expanded);
    this.window.setMinimumSize?.(size.width, size.height);
    this.window.setMaximumSize?.(size.width, size.height);
    if (typeof this.window.setContentSize === 'function') {
      this.window.setContentSize(size.width, size.height, false);
      return;
    }
    this.window.setSize?.(size.width, size.height, false);
  }

  applyAppearance(style) {
    if (!this.window || this.window.isDestroyed()) return;
    const appearance = appearanceOptions(style);
    this.window.setBackgroundMaterial?.(appearance.backgroundMaterial);
    this.window.setBackgroundColor?.(appearance.backgroundColor);
  }

  destroyWindow() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }

    this.window = null;
    this.loaded = false;
  }
}

function isExpandedState(state) {
  return Boolean(state?.preferences?.floating?.expanded);
}

function styleOfState(state) {
  return state?.preferences?.floating?.style ?? 'classic';
}

function widgetSize(style, expanded) {
  if (style === 'mini') return MINI_SIZE;
  return expanded ? EXPANDED_SIZE : COMPACT_SIZE;
}

function appearanceOptions(style) {
  if (style === 'mini') {
    return {
      backgroundColor: '#00000000',
      backgroundMaterial: 'none'
    };
  }

  return {
    backgroundColor: '#000000bf',
    backgroundMaterial: 'acrylic'
  };
}
