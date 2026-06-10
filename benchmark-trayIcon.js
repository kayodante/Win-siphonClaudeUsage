import { app } from 'electron';
import { createTrayIcon } from './src/main/trayIcon.js';

app.whenReady().then(() => {
  const start = performance.now();
  for (let i = 0; i < 1000; i++) {
    createTrayIcon('ok', 'ok');
    createTrayIcon('warn', 'ok');
    createTrayIcon('error', 'ok');
  }
  const end = performance.now();

  console.log(`Time: ${end - start} ms`);
  app.quit();
});
