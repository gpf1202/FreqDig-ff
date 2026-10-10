const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
require("./src/desktopImageExport.cjs").registerImageExport({ ipcMain, dialog, BrowserWindow });

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "electron-preload.cjs"),
      nodeIntegration: false
    }
  });

  window.loadFile(path.join(__dirname, "index.html"));
  let closing = false, allowClose = false, timeout;
  async function saveFailed() {
    if (window.isDestroyed()) return;
    clearTimeout(timeout);
    const result = await dialog.showMessageBox(window, { type: "warning", title: "工程尚未完成自动保存", message: "关闭前保存未完成。", detail: "可以取消退出后手动保存工程，或重试自动保存。直接退出可能丢失最后的修改。", buttons: ["取消退出", "重试保存", "直接退出"], defaultId: 0, cancelId: 0 });
    if (window.isDestroyed()) return;
    closing = false;
    if (result.response === 1) window.close();
    if (result.response === 2) { allowClose = true; window.close(); }
  }
  const onReady = (event, result) => {
    if (event.sender !== window.webContents || !closing) return;
    clearTimeout(timeout);
    if (result?.ok) { allowClose = true; window.close(); } else saveFailed();
  };
  ipcMain.on("workspace-close-ready", onReady);
  window.on("close", event => {
    if (allowClose) return;
    event.preventDefault(); if (closing) return;
    closing = true; window.webContents.send("workspace-save-before-close");
    timeout = setTimeout(saveFailed, 15000);
  });
  window.on("closed", () => { clearTimeout(timeout); ipcMain.removeListener("workspace-close-ready", onReady); });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
