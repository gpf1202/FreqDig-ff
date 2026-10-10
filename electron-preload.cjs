const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("freqdigDesktop", {
  beginImageExport: () => ipcRenderer.invoke("images-export-begin"),
  saveExportImage: (token, name, bytes) => ipcRenderer.invoke("images-export-save", token, name, bytes),
  endImageExport: token => ipcRenderer.invoke("images-export-end", token),
  onCloseRequested(callback) {
    ipcRenderer.on("workspace-save-before-close", async () => {
      try { ipcRenderer.send("workspace-close-ready", { ok: (await callback()) !== false }); }
      catch { ipcRenderer.send("workspace-close-ready", { ok: false }); }
    });
  }
});
