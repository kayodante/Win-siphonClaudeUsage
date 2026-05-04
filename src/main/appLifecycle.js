export function buildTrayMenuTemplate({
  showMainWindow,
  showFloatingWidget,
  showSettingsWindow,
  quit
}) {
  return [
    {
      label: 'Mostrar aplicativo',
      click: showMainWindow
    },
    {
      label: 'Mostrar widget',
      click: showFloatingWidget
    },
    {
      label: 'Configurações',
      click: showSettingsWindow
    },
    { type: 'separator' },
    {
      label: 'Desligar',
      click: quit
    }
  ];
}

export async function startApplication({
  loadWindow,
  showWindow,
  startController,
  onControllerError
}) {
  await loadWindow();
  showWindow();
  try {
    await startController();
  } catch (error) {
    onControllerError?.(error);
  }
}
