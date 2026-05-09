export const STARTUP_HIDDEN_ARG = '--hidden';
export const STARTUP_REGISTRY_NAME = 'Siphon';

export function buildLoginItemSettings(startup = {}, options = {}) {
  const openAtLogin = Boolean(startup.openAtLogin);
  const showWindowOnLogin = startup.showWindowOnLogin === true;

  return {
    openAtLogin,
    path: options.executablePath ?? process.execPath,
    args: openAtLogin && !showWindowOnLogin ? [STARTUP_HIDDEN_ARG] : [],
    name: STARTUP_REGISTRY_NAME
  };
}

export function applyStartupSettings(app, startup = {}, options = {}) {
  const settings = buildLoginItemSettings(startup, options);
  app.setLoginItemSettings(settings);
  return settings;
}

export function shouldStartHidden(argv = process.argv) {
  return argv.includes(STARTUP_HIDDEN_ARG);
}
