export function buildTrayMenuTemplate({
  floatingWidgetEnabled = false,
  statusItems = [],
  showMainWindow,
  toggleFloatingWidget,
  showSettingsWindow,
  restart,
  quit
}) {
  const infoItems = statusItems
    .filter(item => item?.label)
    .map(item => ({
      label: item.label,
      enabled: false
    }));

  return [
    ...infoItems,
    ...(infoItems.length > 0 ? [{ type: 'separator' }] : []),
    {
      label: 'Mostrar aplicativo',
      click: showMainWindow
    },
    {
      label: 'Widget flutuante',
      type: 'checkbox',
      checked: Boolean(floatingWidgetEnabled),
      click: toggleFloatingWidget
    },
    {
      label: 'Configurações',
      click: showSettingsWindow
    },
    { type: 'separator' },
    {
      label: 'Reiniciar',
      click: restart
    },
    {
      label: 'Sair',
      click: quit
    }
  ];
}

export async function startApplication({
  loadWindow,
  showWindow,
  showOnStart = true,
  startController,
  onControllerError
}) {
  await loadWindow();
  if (showOnStart) {
    showWindow();
  }
  try {
    await startController();
  } catch (error) {
    onControllerError?.(error);
  }
}
