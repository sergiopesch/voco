// Minimal Electron app for the field-ladder measurement: one window showing
// the same three HTML fields as the browsers. FIELD_LADDER_ELECTRON_A11Y=1
// calls app.setAccessibilitySupportEnabled(true); nothing else differs.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const field = process.env.FIELD_LADDER_FIELD || 'ta';
if (process.env.FIELD_LADDER_ELECTRON_A11Y === '1') {
  app.whenReady().then(() => app.setAccessibilitySupportEnabled(true));
}
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1000, height: 600, title: 'field-ladder-electron' });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'fields.html'), { hash: field });
  win.webContents.on('did-finish-load', () => {
    console.log('accessibilitySupportEnabled=' + app.accessibilitySupportEnabled);
  });
});
app.on('window-all-closed', () => app.quit());
