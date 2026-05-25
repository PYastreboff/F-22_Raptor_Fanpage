const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const isDev = !app.isPackaged;
let prodServer = null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.hdr': 'application/octet-stream',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2',
};

function createDistServer(distDir) {
  const root = path.resolve(distDir);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const raw = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = raw === '/' ? '/index.html' : raw;
      const file = path.normalize(path.join(root, rel.replace(/^\//, '')));
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        const ext = path.extname(file).toLowerCase();
        res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
    server.on('error', reject);
  });
}

async function createWindow() {
  const iconPath = path.join(
    __dirname,
    isDev ? '../public/favicon.svg' : '../dist/favicon.svg'
  );

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    icon: iconPath,
    backgroundColor: '#9bb8d4',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const distDir = path.join(__dirname, '../dist');
    const { server, url } = await createDistServer(distDir);
    prodServer = server;
    await win.loadURL(url);
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (prodServer) prodServer.close();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
