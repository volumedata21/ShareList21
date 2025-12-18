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

// --- DEBUG LOGGER ---
app.use((req, res, next) => {
  if (!req.url.startsWith('/api/downloads')) { // Reduce noise from polling
    console.log(`[Incoming Request] ${req.method} ${req.url}`);
  }
  next();
});

// --- SECURITY: TRUST PROXY ---
app.set('trust proxy', 1);

// --- SECURITY: RATE LIMITERS ---
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 1000, 
  standardHeaders: true, 
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." }
});

const strictLimiter = rateLimit({
  windowMs: 60 * 1000, 
  max: 10, 
  standardHeaders: true, 
  legacyHeaders: false,
  message: { error: "Too many attempts. You are temporarily blocked." }
});

const DB_PATH = '/data/sharelist.db';
const APP_PIN = process.env.APP_PIN; 
const SYNC_SECRET = process.env.SYNC_SECRET;

// CONFIGURATION
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

// --- DOWNLOAD TRACKING STATE (NEW) ---
interface DownloadStatus {
  id: string;
  filename: string;
  totalBytes: number;
  downloadedBytes: number;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  startTime: number;
  error?: string;
}

const activeDownloads = new Map<string, DownloadStatus>();

const generateId = () => Math.random().toString(36).substring(2, 9);

// --- DB HELPERS ---

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

// Enable WAL mode for better concurrency
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

// --- MIDDLEWARE SETUP ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../dist')));
app.use(generalLimiter);

// --- AUTH MIDDLEWARE ---
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

// --- CORE LOGIC ---

const performLocalScan = async () => {
  if (!fs.existsSync(MEDIA_ROOT)) {
    console.warn(`[Scanner] Media folder ${MEDIA_ROOT} not found. Skipping.`);
    return [];
  }
  console.log(`[Scanner] Scanning local media for ${HOST_USER}...`);
  const files = await processFiles(MEDIA_ROOT, HOST_USER);
  await replaceUserFiles(HOST_USER, files); 
  if (NODE_URL) await registerNode(HOST_USER, NODE_URL);
  
  console.log(`[Scanner] Local DB updated with ${files.length} files.`);
  return files;
};

const syncWithMaster = async (localFiles: MediaFile[]) => {
  if (!MASTER_URL) return; 

  console.log(`[Sync] Connecting to Master: ${MASTER_URL}`);

  try {
    const pushRes = await fetch(`${MASTER_URL}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-secret': SYNC_SECRET || '' },
      body: JSON.stringify({ owner: HOST_USER, url: NODE_URL, files: localFiles })
    });
    if (!pushRes.ok) throw new Error(`Push failed: ${pushRes.statusText}`);
    console.log("[Sync] Push successful.");

    const pullRes = await fetch(`${MASTER_URL}/api/files`, { headers: { 'x-app-pin': APP_PIN || '' } });
    if (!pullRes.ok) throw new Error(`Pull failed: ${pullRes.statusText}`);
    
    const data = await pullRes.json();
    if (data.files && data.nodes) {
        await updateExternalCache(data.files, data.nodes);
        console.log(`[Sync] Pull successful. Cache updated with ${data.files.length} remote items.`);
    }

  } catch (err: any) {
    console.error(`[Sync Error] Could not reach Master: ${err.message}.`);
    throw err; 
  }
};

const ensureDir = (dirPath: string) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

// --- UPDATED DOWNLOAD FUNCTION (With Tracking) ---
const downloadFile = async (remoteUrl: string, remotePath: string, localPath: string, jobId: string) => {
  if (!DOWNLOAD_ROOT) throw new Error("No Download Root configured.");
  if (!SYNC_SECRET) throw new Error("Missing Sync Secret");

  const encodedPath = encodeURIComponent(remotePath);
  const downloadUrl = `${remoteUrl}/api/serve?path=${encodedPath}`;

  ensureDir(path.dirname(localPath));
  console.log(`[Download] Fetching from ${downloadUrl}`);

  // Set Status to Downloading
  const currentStatus = activeDownloads.get(jobId);
  if (currentStatus) {
    activeDownloads.set(jobId, { ...currentStatus, status: 'downloading' });
  }

  return new Promise<void>((resolve, reject) => {
    const lib = downloadUrl.startsWith('https') ? https : http;
    const req = lib.get(downloadUrl, {
      headers: { 'x-sync-secret': SYNC_SECRET }
    }, (response) => {
      if (response.statusCode !== 200) {
        const err = new Error(`Remote Node responded with ${response.statusCode}`);
        if (activeDownloads.has(jobId)) {
             activeDownloads.set(jobId, { ...activeDownloads.get(jobId)!, status: 'error', error: err.message });
        }
        reject(err);
        return;
      }

      // Capture Total Size
      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      if (activeDownloads.has(jobId)) {
        activeDownloads.get(jobId)!.totalBytes = totalSize;
      }

      // Handle 0 Byte files (Create empty file and exit)
      if (totalSize === 0) {
        fs.closeSync(fs.openSync(localPath, 'w'));
        activeDownloads.set(jobId, { ...activeDownloads.get(jobId)!, status: 'completed', downloadedBytes: 0 });
        resolve();
        return;
      }

      const fileStream = fs.createWriteStream(localPath);

      // TRACK PROGRESS
      response.on('data', (chunk) => {
        const job = activeDownloads.get(jobId);
        if (job) {
          job.downloadedBytes += chunk.length;
          activeDownloads.set(jobId, job);
        }
      });

      streamPipeline(response, fileStream)
        .then(() => {
          // Success
          const job = activeDownloads.get(jobId);
          if (job) activeDownloads.set(jobId, { ...job, status: 'completed' });
          
          // Clear from memory after 30 seconds to allow UI to see "Done"
          setTimeout(() => activeDownloads.delete(jobId), 30000); 
          resolve();
        })
        .catch((err) => {
          // Stream Error
          const job = activeDownloads.get(jobId);
          if (job) activeDownloads.set(jobId, { ...job, status: 'error', error: err.message });
          reject(err);
        });
    });
    
    req.on('error', (err) => {
        // Request Error
        const job = activeDownloads.get(jobId);
        if (job) activeDownloads.set(jobId, { ...job, status: 'error', error: err.message });
        reject(err);
    });
  });
};


// --- ROUTES ---

// 1. DOWNLOAD (Queue & Track)
app.post('/api/download', strictLimiter, requirePin, async (req, res) => {
  const { path: singlePath, filename: singleFilename, files, owner, folderName } = req.body;

  let downloadQueue: { remotePath: string, filename: string }[] = [];

  // Build the queue based on whether it's a single file or a batch (album)
  if (files && Array.isArray(files)) {
    downloadQueue = files.map((f: any) => ({
      remotePath: f.path,
      filename: folderName ? path.join(folderName, f.rawFilename) : f.rawFilename
    }));
  } else if (singlePath && singleFilename) {
    downloadQueue = [{ remotePath: singlePath, filename: singleFilename }];
  } else {
    res.status(400).json({ error: "Missing parameters" });
    return;
  }

  if (!owner) {
    res.status(400).json({ error: "Missing owner" });
    return;
  }

  db.get('SELECT url FROM nodes WHERE owner = ?', [owner], async (err, row: any) => {
    if (err || !row || !row.url) {
      console.error(`[Download] No URL found for user: ${owner}`);
      res.status(404).json({ error: `No known URL for user ${owner}` });
      return;
    }

    // Initialize Status for All Items
    const queueIds: string[] = [];
    downloadQueue.forEach(item => {
        const jobId = generateId();
        queueIds.push(jobId);
        activeDownloads.set(jobId, {
            id: jobId,
            filename: item.filename,
            totalBytes: 0,
            downloadedBytes: 0,
            status: 'pending',
            startTime: Date.now()
        });
    });

    res.json({ success: true, message: `Queued ${downloadQueue.length} items from ${owner}...` });

    // Process Download Queue Sequentially
    for (let i = 0; i < downloadQueue.length; i++) {
      const item = downloadQueue[i];
      const jobId = queueIds[i];
      
      try {
        const targetPath = path.join(DOWNLOAD_ROOT, item.filename);
        await downloadFile(row.url, item.remotePath, targetPath, jobId);
        console.log(`[Download] Success: ${item.filename}`);
      } catch (e) {
        console.error(`[Download] Failed: ${item.filename}`, e);
        // Status updated to 'error' inside downloadFile
      }
    }
  });
});

// 2. DOWNLOAD STATUS (NEW)
app.get('/api/downloads', requirePin, (req, res) => {
  const downloads = Array.from(activeDownloads.values()).sort((a,b) => b.startTime - a.startTime);
  res.json(downloads);
});

// 3. CONFIG
app.get('/api/config', (req, res) => {
  res.json({ 
    users: ALLOWED_USERS, 
    requiresPin: !!APP_PIN,
    hostUser: HOST_USER,
    canDownload: fs.existsSync(DOWNLOAD_ROOT)
  });
});

// 4. SERVE FILE
app.get('/api/serve', strictLimiter, requireSecret, (req, res) => {
  const requestPath = req.query.path as string;
  if (!requestPath) { res.status(400).send('Missing path'); return; }
  
  // SECURITY: Prevent Directory Traversal
  const absolutePath = path.resolve(requestPath); 
  const allowedRoot = path.resolve(MEDIA_ROOT);
  const isAllowed = absolutePath.startsWith(allowedRoot) && 
                   (absolutePath.length === allowedRoot.length || 
                    absolutePath[allowedRoot.length] === path.sep);

  if (!isAllowed) {
    console.warn(`[Security Block] Access outside media root: ${absolutePath}`);
    res.status(403).send('Access Denied');
    return;
  }
  
  if (!fs.existsSync(absolutePath)) {
    console.error(`[Serve] File not found: ${absolutePath}`);
    res.status(404).send('File not found');
    return;
  }
  const stat = fs.statSync(absolutePath);
  const head = { 'Content-Length': stat.size, 'Content-Type': 'application/octet-stream' };
  res.writeHead(200, head);
  fs.createReadStream(absolutePath).pipe(res);
});

// 5. SCAN
app.post('/api/scan', strictLimiter, requirePin, async (req, res) => {
  const owner = req.body.owner;
  if (owner === 'ALL' && !MASTER_URL) {
    try {
      await performLocalScan();
      res.json({ success: true, message: "Local Library Scanned." });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
    return;
  }
  try {
    const files = await performLocalScan();
    if (MASTER_URL) { await syncWithMaster(files); }
    res.json({ success: true, count: files.length, message: "Sync Complete." });
  } catch (e: any) {
    console.error(e);
    res.json({ success: true, count: 0, message: "Local scan done, but sync failed." });
  }
});

// 6. SYNC
app.post('/api/sync', strictLimiter, requireSecret, async (req, res) => {
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

// 7. FILES
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist', 'index.html'));
});

// --- AUTOMATION ---
const scheduledScan = async () => {
  console.log(`[Cron] Scheduled scan...`);
  const files = await performLocalScan();
  try { await syncWithMaster(files); } catch(e) {} 
};

setTimeout(scheduledScan, 5000); 
if (cron.validate(CRON_SCHEDULE)) {
  cron.schedule(CRON_SCHEDULE, scheduledScan);
}

app.listen(PORT, '0.0.0.0', () => console.log(`ShareList21 Server (${MASTER_URL ? 'Satellite' : 'Master'}) running on ${PORT}`));