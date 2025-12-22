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

// --- GLOBAL SCAN STATUS ---
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

// --- CORE SCANNER LOGIC ---
const performLocalScan = async () => {
  if (!fs.existsSync(MEDIA_ROOT)) return [];
  console.log(`[Scanner] Reading local disk for ${HOST_USER}...`);
  return await processFiles(MEDIA_ROOT, HOST_USER);
};

const runFullScan = async (forcedOwner?: string) => {
  if (scanStatus.isRunning) return;

  scanStatus = { isRunning: true, step: 'Initializing', localFiles: 0, newLocal: 0, remoteSummary: [], error: null };
  const owner = forcedOwner || HOST_USER;

  try {
    const countBefore = await getFileCount(HOST_USER);

    scanStatus.step = 'Scanning Local Disk...';
    if (owner === 'ALL' && !MASTER_URL) {
       const files = await performLocalScan();
       const countAfter = await getFileCount(HOST_USER);
       await replaceUserFiles(HOST_USER, files);
       
       scanStatus.localFiles = files.length;
       scanStatus.newLocal = Math.max(0, countAfter - countBefore);
       scanStatus.step = 'Complete';
       return;
    }
    
    const files = await performLocalScan();
    await replaceUserFiles(HOST_USER, files); 
    if (NODE_URL) await registerNode(HOST_USER, NODE_URL);

    const countAfter = await getFileCount(HOST_USER);
    scanStatus.localFiles = files.length;
    scanStatus.newLocal = Math.max(0, countAfter - countBefore);

    if (MASTER_URL) { 
      scanStatus.step = 'Syncing with Master...';
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

// --- QUEUE PROCESSOR ---
const processQueue = async () => {
  const downloadingCount = Array.from(activeDownloads.values())
    .filter(d => d.status === 'downloading').length;
  
  if (downloadingCount >= MAX_CONCURRENT_DOWNLOADS) return;

  const nextJob = Array.from(activeDownloads.values())
    .filter(d => d.status === 'pending')
    .sort((a, b) => a.startTime - b.startTime)[0]; 

  if (!nextJob) return; 

  downloadFile(nextJob.remoteUrl, nextJob.remotePath, nextJob.localPath, nextJob.id);
};

// --- DOWNLOAD WORKER (RESUMABLE) ---
const downloadFile = async (remoteUrl: string, remotePath: string, localPath: string, jobId: string) => {
  if (!DOWNLOAD_ROOT) throw new Error("No Download Root configured.");
  
  // 1. Check if FINAL file exists
  if (fs.existsSync(localPath)) {
    const job = activeDownloads.get(jobId);
    if (job) {
       const stats = fs.statSync(localPath);
       activeDownloads.set(jobId, { ...job, status: 'skipped', totalBytes: stats.size, downloadedBytes: stats.size, speed: 0 });
    }
    processQueue();
    return;
  }

  const cleanBaseUrl = remoteUrl.replace(/\/$/, '');
  const encodedPath = encodeURIComponent(remotePath);
  const downloadUrl = `${cleanBaseUrl}/api/serve?path=${encodedPath}`;
  const partPath = `${localPath}.part`;

  ensureDir(path.dirname(localPath));
  console.log(`[Download START] Job ${jobId} -> ${path.basename(localPath)}`);

  const controller = new AbortController();
  const { signal } = controller;

  const currentStatus = activeDownloads.get(jobId);
  if (currentStatus) {
    activeDownloads.set(jobId, { ...currentStatus, status: 'downloading', abortController: controller });
  }

  // 2. RESUME LOGIC: Check for partial file
  let startByte = 0;
  if (fs.existsSync(partPath)) {
    startByte = fs.statSync(partPath).size;
    console.log(`[Download RESUME] Resuming ${path.basename(localPath)} from byte ${startByte}`);
  }

  return new Promise<void>((resolve, reject) => {
    const lib = downloadUrl.startsWith('https') ? https : http;
    const req = lib.get(downloadUrl, {
      headers: { 
        'x-sync-secret': SYNC_SECRET || '',
        'Range': `bytes=${startByte}-` // Request only missing bytes
      },
      signal: signal 
    }, (response) => {
      // Allow 200 (OK) or 206 (Partial Content)
      if (response.statusCode !== 200 && response.statusCode !== 206) {
        const err = new Error(`Remote Node responded with ${response.statusCode}`);
        if (activeDownloads.has(jobId)) {
             activeDownloads.set(jobId, { ...activeDownloads.get(jobId)!, status: 'error', error: err.message });
        }
        processQueue();
        reject(err);
        return;
      }

      // Calculate total size based on Content-Length + what we already have
      // Note: Content-Length in a 206 response is just the chunk size, not total file size
      const contentLength = parseInt(response.headers['content-length'] || '0', 10);
      const totalSize = startByte + contentLength;
      
      if (activeDownloads.has(jobId)) {
        activeDownloads.get(jobId)!.totalBytes = totalSize;
        activeDownloads.get(jobId)!.downloadedBytes = startByte; // Sync start
      }

      // Append if resuming, otherwise create new
      const fileStream = fs.createWriteStream(partPath, { flags: startByte > 0 ? 'a' : 'w' });
      
      let lastCheckTime = Date.now();
      let lastCheckBytes = startByte;

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
          // 3. Rename .part to final upon success
          fs.renameSync(partPath, localPath);
          const job = activeDownloads.get(jobId);
          if (job) activeDownloads.set(jobId, { ...job, status: 'completed', speed: 0 });
          processQueue();
          resolve();
        })
        .catch((err) => {
          if (err.code === 'ABORT_ERR') {
             console.log(`[Download] Job ${jobId} cancelled.`);
             // DO NOT DELETE .PART FILE ON CANCEL
             processQueue();
             resolve();
          } else {
             const job = activeDownloads.get(jobId);
             const errMsg = err.code === 'ECONNRESET' ? 'Network Error (Reset)' : err.message;
             if (job) activeDownloads.set(jobId, { ...job, status: 'error', error: errMsg });
             processQueue();
             reject(err);
          }
        });
    });
    req.on('error', (err: any) => {
        if (err.name === 'AbortError') return; 
        const job = activeDownloads.get(jobId);
        const errMsg = err.code === 'ECONNRESET' ? 'Network Error (Reset)' : err.message;
        if (job) activeDownloads.set(jobId, { ...job, status: 'error', error: errMsg });
        processQueue(); 
        reject(err);
    });
  });
};

// --- ROUTES ---

// NEW: Helper for Inventory (Split Complete vs Partial)
const getRecursiveFilenames = (dir: string): { complete: string[], partials: string[] } => {
  let complete: string[] = [];
  let partials: string[] = [];
  
  if (!fs.existsSync(dir)) return { complete, partials };
  
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) { 
      const sub = getRecursiveFilenames(filePath);
      complete = complete.concat(sub.complete);
      partials = partials.concat(sub.partials);
    } else { 
      if (file.endsWith('.part')) {
        partials.push(file.replace('.part', '')); // Store base name
      } else {
        complete.push(file);
      }
    }
  });
  return { complete, partials };
};

// UPDATED Inventory Route
app.get('/api/inventory', requirePin, (req, res) => {
  try {
    const data = getRecursiveFilenames(DOWNLOAD_ROOT);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

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
    
    newJobs.forEach(item => {
        const jobId = generateId();
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
    processQueue();
  });
});

app.post('/api/download/cancel', requirePin, (req, res) => {
  const { id } = req.body;
  const job = activeDownloads.get(id);
  if (job) {
    if (job.abortController) { job.abortController.abort(); }
    activeDownloads.set(id, { ...job, status: 'cancelled', speed: 0 });
    processQueue();
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
  activeDownloads.set(id, { ...job, status: 'pending', error: undefined, speed: 0, startTime: Date.now() });
  res.json({ success: true, message: "Re-queued..." });
  processQueue();
});

app.post('/api/downloads/clear', requirePin, (req, res) => {
  for (const [id, job] of activeDownloads.entries()) {
    if (['completed','cancelled','error','skipped'].includes(job.status)) activeDownloads.delete(id);
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
  res.json({ users: ALLOWED_USERS, requiresPin: !!APP_PIN, hostUser: HOST_USER, canDownload: fs.existsSync(DOWNLOAD_ROOT) });
});

// UPDATED: Support Range Requests for Resume
app.get('/api/serve', mediaLimiter, requireSecret, (req, res) => {
  const requestPath = req.query.path as string;
  if (!requestPath) { res.status(400).send('Missing path'); return; }
  const absolutePath = path.resolve(requestPath); 
  const allowedRoot = path.resolve(MEDIA_ROOT);
  
  if (!absolutePath.startsWith(allowedRoot) || !fs.existsSync(absolutePath)) {
    res.status(404).send('File not found or Access Denied');
    return;
  }

  const stat = fs.statSync(absolutePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(absolutePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'application/octet-stream',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = { 'Content-Length': fileSize, 'Content-Type': 'application/octet-stream' };
    res.writeHead(200, head);
    fs.createReadStream(absolutePath).pipe(res);
  }
});

// --- CONNECTION TEST ---
app.get('/api/ping', requireSecret, (req, res) => {
  res.json({ success: true, message: 'Pong', role: MASTER_URL ? 'Satellite' : 'Master' });
});

app.post('/api/test-connection', generalLimiter, requirePin, async (req, res) => {
  if (!MASTER_URL) return res.json({ success: true, message: "Running in Master/Local Mode" });
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); 
    const response = await fetch(`${MASTER_URL}/api/ping`, { headers: { 'x-sync-secret': SYNC_SECRET || '' }, signal: controller.signal });
    clearTimeout(timeout);
    if (response.ok) res.json({ success: true, message: "Connected to Master successfully." });
    else res.status(response.status).json({ success: false, message: `Master returned status ${response.status}` });
  } catch (err: any) {
    res.status(500).json({ success: false, message: `Connection Failed` });
  }
});

// --- SCANNING ---
app.get('/api/scan-status', requirePin, (req, res) => res.json(scanStatus));

app.post('/api/scan', scanLimiter, requirePin, (req, res) => {
  if (scanStatus.isRunning) return res.status(409).json({ error: "Scan already in progress." });
  res.json({ success: true, message: "Scan started in background." });
  runFullScan(req.body.owner);
});

app.post('/api/sync', generalLimiter, requireSecret, async (req, res) => {
  const { owner, files, url } = req.body as SyncPayload;
  if (MASTER_URL) { res.status(400).json({ error: "Satellite cannot receive sync." }); return; }
  if (!ALLOWED_USERS.includes(owner)) { res.status(403).json({ error: 'User not allowed' }); return; }
  try {
    await replaceUserFiles(owner, files);
    if (url) await registerNode(owner, url); 
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

app.get('/api/files', requirePin, (req, res) => {
  const query = `SELECT m.*, n.url as remote_url FROM media_files m LEFT JOIN nodes n ON m.owner = n.owner ORDER BY m.filename ASC`;
  db.all(query, (err, rows: any[]) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    const files = rows.map(r => ({ ...r, rawFilename: r.filename, sizeBytes: r.size_bytes, lastModified: r.last_modified, remoteUrl: r.remote_url }));
    db.all('SELECT * FROM nodes', (err2, nodes) => { res.json({ files, nodes: nodes || [] }); });
  });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../dist', 'index.html')));

setTimeout(() => runFullScan(), 5000); 
if (cron.validate(CRON_SCHEDULE)) { cron.schedule(CRON_SCHEDULE, () => runFullScan()); }

const server = app.listen(PORT, '0.0.0.0', () => console.log(`ShareList21 Server running on ${PORT}`));
server.setTimeout(0);