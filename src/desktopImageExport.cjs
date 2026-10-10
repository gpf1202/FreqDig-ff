const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

// Renderer receives a session token, never filesystem access or a writable path.
function registerImageExport({ ipcMain, dialog, BrowserWindow }) {
  const sessions = new Map();
  ipcMain.handle('images-export-begin', async event => {
    const owner = event.sender;
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(owner), {
      title: '选择批量图片保存文件夹', properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0] || owner.isDestroyed()) return null;
    const token = randomUUID();
    sessions.set(token, { owner, directory: path.resolve(result.filePaths[0]) });
    owner.once('destroyed', () => { for (const [key, value] of sessions) if (value.owner === owner) sessions.delete(key); });
    return token;
  });
  ipcMain.handle('images-export-save', async (event, token, name, bytes) => {
    const session = sessions.get(token);
    if (!session || session.owner !== event.sender) throw new Error('导出会话已失效');
    if (typeof name !== 'string' || name.length > 220 || /[\\/:*?"<>|\x00-\x1f]/.test(name) || !/\.(png|svg)$/i.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name)) throw new Error('无效图片文件名');
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 256 * 1024 * 1024) throw new Error('无效图片数据');
    const extension = path.extname(name), stem = name.slice(0, -extension.length);
    for (let index = 0; index < 10000; index++) {
      const filename = index ? `${stem}_${index + 1}${extension}` : name;
      const target = path.resolve(session.directory, filename);
      if (path.dirname(target) !== session.directory) throw new Error('无效保存路径');
      try { await fs.writeFile(target, bytes, { flag: 'wx' }); return filename; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    throw new Error('同名图片过多，请选择其他文件夹');
  });
  ipcMain.handle('images-export-end', (event, token) => {
    if (sessions.get(token)?.owner === event.sender) sessions.delete(token);
  });
}
module.exports = { registerImageExport };
