import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import pkg from 'sqlite3';
import cors from 'cors';
import cron from 'node-cron';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { processFiles } from './scanner';
import { MediaFile, SyncPayload } from './types';
import http from 'http';
import https from 'https';
import { pipeline } from 'stream';
import { promisify } from 'util';
import rateLimit from 'express-rate-limit'; 

const streamPipeline = promisify(pipeline);
const { verbose } = pkg; 
const sqlite3 = verbose();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 80;

// --- CONFIGURATION ---
const MAX_CONCURRENT_DOWNLOADS = 1; 

app.set('trust proxy', 1);

// --- LIMITERS ---
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, message: { error: "Too many requests." } });
const scanLimiter = rateLimit({ windowMs: 60 * 1000, max: 6, message: { error: "Scanning too frequently. Please wait 10 seconds." } });
const mediaLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10000, message: { error: "Download quota exceeded. Please wait." } });

// --- DB & ENV ---
const DB_PATH = '/data/sharelist.db';
const APP_PIN = process.env.APP_PIN; 
const SYNC_SECRET = process.env.SYNC_SECRET;
const MASTER_URL = process.env.MASTER_URL; 
const NODE_URL = process.env.NODE_URL || ''; 
const HOST_USER = process.env.HOST_USER || 'Guest'; 
const MEDIA_ROOT = process.env.MEDIA_ROOT || '/media';
const DOWNLOAD_ROOT = process.env.DOWNLOAD_ROOT || '/downloads';
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 3 * * *';

const ALLOWED_USERS = (process.env.APP_USERS || 'Guest').split(',').map(u => u.trim());

if (!fs.existsSync('/data')) fs.mkdirSync('/data');
if (DOWNLOAD_ROOT && !fs.existsSync(DOWNLOAD_ROOT)) {
  try { fs.mkdirSync(DOWNLOAD_ROOT); } catch (e) { console.warn("Could not create download root:", e); }
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error("Database connection error:", err.message);
  else console.log(`Connected to SQLite DB. Running as user: ${HOST_USER}`);
});

// --- GLOBAL SCAN STATUS (NEW) ---
// Tracks the state of the scanner for the UI
let scanStatus = {
  isRunning: false,
  step: 'Idle', 
  localFiles: 0,
  newLocal: 0,
  remoteSummary: [] as string[], 
  error: null as string | null
};

// --- DOWNLOAD STATE ---
interface DownloadStatus {
  id: string;
  filename: string;
  remoteUrl: string;
  remotePath: string;
  localPath: string;
  totalBytes: number;
  downloadedBytes: number;
  status: 'pending' | 'downloading' | 'completed' | 'error' | 'cancelled' | 'skipped';
  startTime: number;
  speed: number; 
  error?: string;
  abortController?: AbortController; 
}

const activeDownloads = new Map<string, DownloadStatus>();

const generateId = () => Math.random().toString(36).substring(2, 9);

// --- DB HELPERS ---
const getFileCount = (owner: string): Promise<number> => {
  return new Promise((resolve) => {
    db.get("SELECT COUNT(*) as count FROM media_files WHERE owner = ?", [owner], (err, row: any) => {
      resolve(row ? row.count : 0);
    });
  });
};

const registerNode = (owner: string, url: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO nodes (owner, url) VALUES (?, ?) 
            ON CONFLICT(owner) DO UPDATE SET url=excluded.url`, 
            [owner, url], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

const replaceUserFiles = (owner: string, files: MediaFile[]): Promise<void> => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.run('DELETE FROM media_files WHERE owner = ?', [owner]);
      const stmt = db.prepare(`INSERT INTO media_files VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      try {
        files.forEach(f => {
          stmt.run(`${owner}:${f.path}`, owner, f.rawFilename, f.path, f.library, f.quality, f.sizeBytes, f.lastModified);
        });
        stmt.finalize();
        db.run('COMMIT', () => resolve());
      } catch (err) { 
        db.run('ROLLBACK'); 
        reject(err); 
      }
    });
  });
};

const updateExternalCache = (files: MediaFile[], nodes: {owner:string, url:string}[]): Promise<void> => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      const nodeStmt = db.prepare(`INSERT INTO nodes (owner, url) VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET url=excluded.url`);
      nodes.forEach(n => nodeStmt.run(n.owner, n.url));
      nodeStmt.finalize();

      db.run('DELETE FROM media_files WHERE owner != ?', [HOST_USER]);
      const fileStmt = db.prepare(`INSERT INTO media_files VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      try {
        files.forEach(f => {
          if (f.owner !== HOST_USER) {
            fileStmt.run(`${f.owner}:${f.path}`, f.owner, f.rawFilename, f.path, f.library, f.quality, f.sizeBytes, f.lastModified);
          }
        });
        fileStmt.finalize();
        db.run('COMMIT', () => resolve());
      } catch (err) { 
        db.run('ROLLBACK'); 
        reject(err); 
      }
    });
  });
};

const cleanupOrphanedUsers = () => {
  if (MASTER_URL) return; 
  if (ALLOWED_USERS.length === 0) return;
  const placeholders = ALLOWED_USERS.map(() => '?').join(',');
  const query = `DELETE FROM media_files WHERE owner NOT IN (${placeholders})`;
  db.run(query, ALLOWED_USERS, (err) => { if (err) console.error(err); });
};

db.serialize(() => {
  db.run("PRAGMA journal_mode = WAL;"); 
  db.run(`CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY, owner TEXT, filename TEXT, path TEXT, 
    library TEXT, quality TEXT, size_bytes INTEGER, last_modified INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS nodes (
    owner TEXT PRIMARY KEY, url TEXT
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_owner ON media_files(owner)");
  cleanupOrphanedUsers();
  if (NODE_URL) registerNode(HOST_USER, NODE_URL);
});

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../dist')));
app.use(generalLimiter);

// --- AUTH ---
const requirePin = async (req: Request, res: Response, next: NextFunction) => {
  if (!APP_PIN) return next();
  const provided = req.headers['x-app-pin'];
  if (String(provided) !== String(APP_PIN)) {
     await new Promise(resolve => setTimeout(resolve, 1000));
     return res.status(401).json({ error: 'Invalid PIN' });
  }
  next();
};

const requireSecret = async (req: Request, res: Response, next: NextFunction) => {
  if (!SYNC_SECRET) return res.status(500).json({ error: 'No Sync Secret set.' });
  if (String(req.headers['x-sync-secret']) !== String(SYNC_SECRET)) {
     await new Promise(resolve => setTimeout(resolve, 1000));
     return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// --- CORE SCANNER LOGIC (Refactored to avoid Race Conditions) ---

const performLocalScan = async () => {
  if (!fs.existsSync(MEDIA_ROOT)) return [];
  console.log(`[Scanner] Reading local disk for ${HOST_USER}...`);
  return await processFiles(MEDIA_ROOT, HOST_USER);
};

const runFullScan = async (forcedOwner?: string) => {
  // Prevent overlapping scans (Race Condition Fix)
  if (scanStatus.isRunning) {
    console.log("[Scanner] Skip: Scan already in progress.");
    return;
  }

  scanStatus = { isRunning: true, step: 'Initializing', localFiles: 0, newLocal: 0, remoteSummary: [], error: null };
  const owner = forcedOwner || HOST_USER;

  try {
    const countBefore = await getFileCount(HOST_USER);

    // 1. Local Scan
    scanStatus.step = 'Scanning Local Disk...';
    if (owner === 'ALL' && !MASTER_URL) {
       const files = await performLocalScan();
       const countAfter = await getFileCount(HOST_USER);
       // Update DB if local only
       await replaceUserFiles(HOST_USER, files);
       
       scanStatus.localFiles = files.length;
       scanStatus.newLocal = Math.max(0, countAfter - countBefore);
       scanStatus.step = 'Complete';
       return;
    }
    
    // 2. Perform Scan & Local Save
    const files = await performLocalScan();
    await replaceUserFiles(HOST_USER, files); 
    if (NODE_URL) await registerNode(HOST_USER, NODE_URL);

    const countAfter = await getFileCount(HOST_USER);
    scanStatus.localFiles = files.length;
    scanStatus.newLocal = Math.max(0, countAfter - countBefore);

    // 3. Sync with Master
    if (MASTER_URL) { 
      scanStatus.step = 'Syncing with Master...';
      
      // PUSH
      try {
        const pushRes = await fetch(`${MASTER_URL}/api/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-sync-secret': SYNC_SECRET || '' },
          body: JSON.stringify({ owner: HOST_USER, url: NODE_URL, files })
        });
        if (!pushRes.ok) throw new Error(`Push failed: ${pushRes.statusText}`);
        scanStatus.remoteSummary.push(`Pushed to Master: Success`);
      } catch(e: any) {
        scanStatus.remoteSummary.push(`Push Failed: ${e.message}`);
        console.error(e);
      }

      // PULL
      try {
        const pullRes = await fetch(`${MASTER_URL}/api/files`, { headers: { 'x-app-pin': APP_PIN || '' } });
        if (!pullRes.ok) throw new Error(`Pull failed: ${pullRes.statusText}`);
        const data = await pullRes.json();
        if (data.files && data.nodes) {
            const users = new Set(data.files.map((f:any) => f.owner));
            users.delete(HOST_USER); 
            const totalExternal = data.files.filter((f:any) => f.owner !== HOST_USER).length;
            await updateExternalCache(data.files, data.nodes);
            scanStatus.remoteSummary.push(`Synced ${users.size} other users (${totalExternal} files).`);
        }
      } catch (err: any) {
        scanStatus.remoteSummary.push(`Pull Failed: ${err.message}`);
        console.error(err);
      }
    }

    scanStatus.step = 'Complete';
  } catch (e: any) {
    console.error("[Scanner] Error:", e.message);
    scanStatus.error = e.message;
    scanStatus.step = 'Error';
  } finally {
    scanStatus.isRunning = false;
  }
};

const ensureDir = (dirPath: string) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

// --- DOWNLOAD WORKER ---
const downloadFile = async (remoteUrl: string, remotePath: string, localPath: string, jobId: string) => {
  if (!DOWNLOAD_ROOT) throw new Error("No Download Root configured.");
  
  if (fs.existsSync(localPath)) {
    const job = activeDownloads.get(jobId);
    if (job) {
       const stats = fs.statSync(localPath);
       activeDownloads.set(jobId, { ...job, status: 'skipped', totalBytes: stats.size, downloadedBytes: stats.size, speed: 0 });
    }
    return;
  }

  const cleanBaseUrl = remoteUrl.replace(/\/$/, '');
  const encodedPath = encodeURIComponent(remotePath);
  const downloadUrl = `${cleanBaseUrl}/api/serve?path=${encodedPath}`;

  ensureDir(path.dirname(localPath));
  console.log(`[Download START] Job ${jobId} -> ${path.basename(localPath)}`);

  const controller = new AbortController();
  const { signal } = controller;

  const currentStatus = activeDownloads.get(jobId);
  if (currentStatus) {
    activeDownloads.set(jobId, { ...currentStatus, status: 'downloading', abortController: controller });
  }

  return new Promise<void>((resolve, reject) => {
    const lib = downloadUrl.startsWith('https') ? https : http;
    const req = lib.get(downloadUrl, {
      headers: { 'x-sync-secret': SYNC_SECRET || '' },
      signal: signal 
    }, (response) => {
      if (response.statusCode !== 200) {
        const err = new Error(`Remote Node responded with ${response.statusCode}`);
        if (activeDownloads.has(jobId)) {
             activeDownloads.set(jobId, { ...activeDownloads.get(jobId)!, status: 'error', error: err.message });
        }
        reject(err);
        return;
      }
      const contentType = response.headers['content-type'] || '';
      if (contentType.includes('text/html')) {
        const err = new Error("Remote node returned HTML. Check NODE_URL.");
        if (activeDownloads.has(jobId)) {
             activeDownloads.set(jobId, { ...activeDownloads.get(jobId)!, status: 'error', error: "Config Error: HTML Response" });
        }
        response.resume();
        reject(err);
        return;
      }
      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      if (activeDownloads.has(jobId)) {
        activeDownloads.get(jobId)!.totalBytes = totalSize;
      }
      if (totalSize === 0) {
        fs.closeSync(fs.openSync(localPath, 'w'));
        const job = activeDownloads.get(jobId);
        if (job) activeDownloads.set(jobId, { ...job, status: 'completed', downloadedBytes: 0 });
        resolve();
        return;
      }
      const fileStream = fs.createWriteStream(localPath);
      let lastCheckTime = Date.now();
      let lastCheckBytes = 0;
      response.on('data', (chunk) => {
        const job = activeDownloads.get(jobId);
        if (job) {
          job.downloadedBytes += chunk.length;
          const now = Date.now();
          if (now - lastCheckTime > 1000) {
            const bytesDiff = job.downloadedBytes - lastCheckBytes;
            const timeDiff = (now - lastCheckTime) / 1000;
            job.speed = Math.floor(bytesDiff / timeDiff);
            lastCheckTime = now;
            lastCheckBytes = job.downloadedBytes;
          }
          activeDownloads.set(jobId, job);
        }
      });
      streamPipeline(response, fileStream)
        .then(() => {
          const job = activeDownloads.get(jobId);
          if (job) activeDownloads.set(jobId, { ...job, status: 'completed', speed: 0 });
          resolve();
        })
        .catch((err) => {
          if (err.code === 'ABORT_ERR') {
             console.log(`[Download] Job ${jobId} cancelled.`);
             try { fs.unlinkSync(localPath); } catch(e) {}
             resolve();
          } else {
             const job = activeDownloads.get(jobId);
             const errMsg = err.code === 'ECONNRESET' ? 'Network Error (Reset)' : err.message;
             if (job) activeDownloads.set(jobId, { ...job, status: 'error', error: errMsg });
             reject(err);
          }
        });
    });
    req.on('error', (err: any) => {
        if (err.name === 'AbortError') return; 
        const job = activeDownloads.get(jobId);
        const errMsg = err.code === 'ECONNRESET' ? 'Network Error (Reset)' : err.message;
        if (job) activeDownloads.set(jobId, { ...job, status: 'error', error: errMsg });
        reject(err);
    });
  });
};

// --- ROUTES ---

app.post('/api/download', generalLimiter, requirePin, async (req, res) => {
  const { path: singlePath, filename: singleFilename, files, owner, folderName } = req.body;
  let newJobs: { remotePath: string, filename: string }[] = [];
  if (files && Array.isArray(files)) {
    newJobs = files.map((f: any) => ({
      remotePath: f.path,
      filename: folderName ? path.join(folderName, f.rawFilename) : f.rawFilename
    }));
  } else if (singlePath && singleFilename) {
    newJobs = [{ remotePath: singlePath, filename: singleFilename }];
  } else {
    res.status(400).json({ error: "Missing parameters" });
    return;
  }
  if (!owner) { res.status(400).json({ error: "Missing owner" }); return; }
  db.get('SELECT url FROM nodes WHERE owner = ?', [owner], async (err, row: any) => {
    if (err || !row || !row.url) {
      res.status(404).json({ error: `No known URL for user ${owner}` });
      return;
    }
    const queueIds: string[] = [];
    newJobs.forEach(item => {
        const jobId = generateId();
        queueIds.push(jobId);
        activeDownloads.set(jobId, {
            id: jobId,
            filename: item.filename,
            remoteUrl: row.url,
            remotePath: item.remotePath,
            localPath: path.join(DOWNLOAD_ROOT, item.filename),
            totalBytes: 0,
            downloadedBytes: 0,
            status: 'pending', 
            startTime: Date.now(),
            speed: 0
        });
    });
    res.json({ success: true, message: `Queued ${newJobs.length} items...` });
    for (let i = 0; i < newJobs.length; i++) {
        const jobId = queueIds[i];
        const job = activeDownloads.get(jobId);
        if (!job || job.status === 'cancelled') continue;
        try {
            await downloadFile(job.remoteUrl, job.remotePath, job.localPath, jobId);
        } catch (e) {
            console.error(`[Download Loop] Error on item ${i}`, e);
        }
    }
  });
});

app.post('/api/download/cancel', requirePin, (req, res) => {
  const { id } = req.body;
  const job = activeDownloads.get(id);
  if (job) {
    if (job.abortController) { job.abortController.abort(); }
    activeDownloads.set(id, { ...job, status: 'cancelled', speed: 0 });
    res.json({ success: true, message: "Cancelled" });
  } else {
    res.status(404).json({ error: "Job not found" });
  }
});

app.post('/api/download/retry', requirePin, async (req, res) => {
  const { id } = req.body;
  const job = activeDownloads.get(id);
  if (!job) { return res.status(404).json({ error: "Job not found" }); }
  if (job.status === 'downloading') { return res.status(400).json({ error: "Already downloading" }); }
  activeDownloads.set(id, { ...job, status: 'pending', error: undefined, speed: 0 });
  res.json({ success: true, message: "Re-queued..." });
  try {
     await downloadFile(job.remoteUrl, job.remotePath, job.localPath, id);
  } catch(e) {
     console.error("Retry failed", e);
  }
});

app.post('/api/downloads/clear', requirePin, (req, res) => {
  for (const [id, job] of activeDownloads.entries()) {
    if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'error' || job.status === 'skipped') {
      activeDownloads.delete(id);
    }
  }
  res.json({ success: true });
});

app.get('/api/downloads', requirePin, (req, res) => {
  const downloads = Array.from(activeDownloads.values())
    .map(({ abortController, ...rest }) => rest)
    .sort((a,b) => b.startTime - a.startTime);
  res.json(downloads);
});

app.get('/api/config', (req, res) => {
  res.json({ 
    users: ALLOWED_USERS, 
    requiresPin: !!APP_PIN,
    hostUser: HOST_USER,
    canDownload: fs.existsSync(DOWNLOAD_ROOT)
  });
});

app.get('/api/serve', mediaLimiter, requireSecret, (req, res) => {
  const requestPath = req.query.path as string;
  if (!requestPath) { res.status(400).send('Missing path'); return; }
  const absolutePath = path.resolve(requestPath); 
  const allowedRoot = path.resolve(MEDIA_ROOT);
  const isAllowed = absolutePath.startsWith(allowedRoot);
  if (!isAllowed || !fs.existsSync(absolutePath)) {
    res.status(404).send('File not found or Access Denied');
    return;
  }
  const stat = fs.statSync(absolutePath);
  const head = { 'Content-Length': stat.size, 'Content-Type': 'application/octet-stream' };
  res.writeHead(200, head);
  fs.createReadStream(absolutePath).pipe(res);
});

// --- CONNECTION TESTING ROUTES ---

app.get('/api/ping', requireSecret, (req, res) => {
  res.json({ success: true, message: 'Pong', role: MASTER_URL ? 'Satellite' : 'Master' });
});

app.post('/api/test-connection', generalLimiter, requirePin, async (req, res) => {
  if (!MASTER_URL) {
    return res.json({ success: true, message: "Running in Master/Local Mode (No Master URL set)" });
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
    const response = await fetch(`${MASTER_URL}/api/ping`, {
      headers: { 'x-sync-secret': SYNC_SECRET || '' },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (response.ok) {
      res.json({ success: true, message: "Connected to Master successfully." });
    } else if (response.status === 401 || response.status === 403) {
      res.status(401).json({ success: false, message: "Authentication Failed: Check SYNC_SECRET." });
    } else if (response.status === 404) {
      res.status(404).json({ success: false, message: "Server found, but API missing. Check MASTER_URL." });
    } else {
      res.status(500).json({ success: false, message: `Master returned status ${response.status}` });
    }
  } catch (err: any) {
    const msg = err.name === 'AbortError' ? 'Connection Timed Out (5s)' : (err.message || 'Network Error');
    res.status(500).json({ success: false, message: `Connection Failed: ${msg}` });
  }
});

// --- UPDATED SCANNING LOGIC (Async + Centralized) ---

// 1. Status Endpoint
app.get('/api/scan-status', requirePin, (req, res) => {
  res.json(scanStatus);
});

// 2. Trigger Scan
app.post('/api/scan', scanLimiter, requirePin, (req, res) => {
  if (scanStatus.isRunning) return res.status(409).json({ error: "Scan already in progress." });
  
  // Immediately reply to avoid 504 Timeout
  res.json({ success: true, message: "Scan started in background." });
  
  // Run scan in background
  runFullScan(req.body.owner);
});

// 3. Receive Sync (Keep existing logic)
app.post('/api/sync', generalLimiter, requireSecret, async (req, res) => {
  const { owner, files, url } = req.body as SyncPayload;
  if (MASTER_URL) { res.status(400).json({ error: "Satellite cannot receive sync." }); return; }
  if (!ALLOWED_USERS.includes(owner)) { res.status(403).json({ error: 'User not allowed' }); return; }
  try {
    await replaceUserFiles(owner, files);
    if (url) await registerNode(owner, url); 
    console.log(`[API] Received ${files.length} files from ${owner}`);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/files', requirePin, (req, res) => {
  const query = `
    SELECT m.*, n.url as remote_url 
    FROM media_files m 
    LEFT JOIN nodes n ON m.owner = n.owner 
    ORDER BY m.filename ASC
  `;
  db.all(query, (err, rows: any[]) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    const files = rows.map(r => ({ ...r, rawFilename: r.filename, sizeBytes: r.size_bytes, lastModified: r.last_modified, remoteUrl: r.remote_url }));
    db.all('SELECT * FROM nodes', (err2, nodes) => {
       res.json({ files, nodes: nodes || [] });
    });
  });
});

// ----------------------------------------

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist', 'index.html'));
});

// --- CRON ---
// Calls the new centralized scanner to prevent race conditions
setTimeout(() => runFullScan(), 5000); 
if (cron.validate(CRON_SCHEDULE)) {
  cron.schedule(CRON_SCHEDULE, () => runFullScan());
}

// --- SERVER START ---
const server = app.listen(PORT, '0.0.0.0', () => console.log(`ShareList21 Server running on ${PORT}`));
server.setTimeout(0);