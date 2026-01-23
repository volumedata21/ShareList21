import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import Database from 'better-sqlite3';
import cors from 'cors';
import cron from 'node-cron';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { processFiles } from './scanner';
import { MediaFile, SyncPayload, DownloadStatus, UploadStatus } from './src/types';
import http from 'http';
import https from 'https';
import { pipeline } from 'stream';
import { promisify } from 'util';
import rateLimit from 'express-rate-limit';
import checkDiskSpace from 'check-disk-space';

const streamPipeline = promisify(pipeline);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 80;

// --- CONFIGURATION ---
const DB_PATH = '/data/sharelist.db';
const APP_PIN = process.env.APP_PIN;
const SYNC_SECRET = process.env.SYNC_SECRET;
const MASTER_URL = process.env.MASTER_URL;
const NODE_URL = process.env.NODE_URL || '';
const HOST_USER = process.env.HOST_USER || 'Guest';
const MEDIA_ROOT = process.env.MEDIA_ROOT || '/media';
const DOWNLOAD_ROOT = process.env.DOWNLOAD_ROOT || '/downloads';
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 3 * * *';
const AVATAR_ROOT = process.env.AVATAR_ROOT || '/avatars';

const ALLOWED_USERS = (process.env.APP_USERS || 'Guest').split(',').map(u => u.trim());

// --- AGENTS (Connection Pooling) ---
const httpAgent = new http.Agent({ keepAlive: true, timeout: 30000 });
const httpsAgent = new https.Agent({ keepAlive: true, timeout: 30000 });

if (!fs.existsSync('/data')) fs.mkdirSync('/data');
if (!fs.existsSync(AVATAR_ROOT)) {
  try { fs.mkdirSync(AVATAR_ROOT); } catch (e) { console.warn("Could not create avatar root:", e); }
}
if (DOWNLOAD_ROOT && !fs.existsSync(DOWNLOAD_ROOT)) {
  try { fs.mkdirSync(DOWNLOAD_ROOT); } catch (e) { console.warn("Could not create download root:", e); }
}

const db = new Database(DB_PATH, { verbose: console.log });
db.pragma('journal_mode = WAL');
console.log(`Connected to DB. User: ${HOST_USER}`);

// --- STATE ---
// FIX: Extend the shared type to add the backend-only abortController
interface ActiveDownload extends DownloadStatus {
  abortController?: AbortController;
}

const activeDownloads = new Map<string, ActiveDownload>();
const activeUploads = new Map<string, UploadStatus>();
const generateId = () => Math.random().toString(36).substring(2, 9);
const downloadQueue: string[] = [];
let isQueueProcessing = false;

// NEW: Global Scan State
let globalScanStatus = {
  isRunning: false,
  step: 'Idle',
  localFiles: 0,
  newLocal: 0,
  remoteSummary: [] as string[],
  error: null as string | null
};

// --- DB HELPERS ---
const registerNode = (owner: string, url: string) => {
  const stmt = db.prepare(`INSERT INTO nodes (owner, url) VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET url=excluded.url`);
  stmt.run(owner, url);
};

// --- FIX: This function was broken in your snippet ---
const replaceUserFiles = (owner: string, files: MediaFile[]) => {
  const deleteStmt = db.prepare('DELETE FROM media_files WHERE owner = ?');
  const insertStmt = db.prepare(`INSERT INTO media_files VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  // 1. Delete old files in one go (fast)
  deleteStmt.run(owner);

  // 2. Insert new files in small chunks to prevent locking the DB for too long
  const CHUNK_SIZE = 500;
  for (let i = 0; i < files.length; i += CHUNK_SIZE) {
    const chunk = files.slice(i, i + CHUNK_SIZE);

    // Tiny transaction for this chunk only
    const transaction = db.transaction((batch) => {
      for (const f of batch) {
        insertStmt.run(
          `${owner}:${f.path}`,
          owner,
          f.rawFilename,
          f.path,
          f.library,
          f.quality,
          f.sizeBytes,
          f.lastModified
        );
      }
    });

    transaction(chunk);
  }
};

const updateExternalCache = (files: MediaFile[], nodes: { owner: string, url: string }[]) => {
  const nodeStmt = db.prepare(`INSERT INTO nodes (owner, url) VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET url=excluded.url`);
  const deleteStmt = db.prepare('DELETE FROM media_files WHERE owner != ?');
  const fileStmt = db.prepare(`INSERT INTO media_files VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  const transaction = db.transaction(() => {
    // Update Nodes
    for (const n of nodes) {
      nodeStmt.run(n.owner, n.url);
    }

    // Clear old cache (everything except your own files)
    deleteStmt.run(HOST_USER);

    // Insert new files
    for (const f of files) {
      if (f.owner !== HOST_USER) {
        fileStmt.run(
          `${f.owner}:${f.path}`,
          f.owner,
          f.rawFilename,
          f.path,
          f.library,
          f.quality,
          f.sizeBytes,
          f.lastModified
        );
      }
    }
  });

  transaction();
};

try {
  // Create tables immediately
  db.exec(`CREATE TABLE IF NOT EXISTS media_files (id TEXT PRIMARY KEY, owner TEXT, filename TEXT, path TEXT, library TEXT, quality TEXT, size_bytes INTEGER, last_modified INTEGER)`);
  db.exec(`CREATE TABLE IF NOT EXISTS nodes (owner TEXT PRIMARY KEY, url TEXT)`);

  if (NODE_URL) {
    registerNode(HOST_USER, NODE_URL);
  }
} catch (err) {
  console.error("Failed to initialize DB:", err);
}

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json({ limit: '50mb' }));
const distPath = path.join(__dirname, '../dist');
app.set('trust proxy', 1);

const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 });
app.use(generalLimiter);

const requirePin = async (req: Request, res: Response, next: NextFunction) => {
  if (!APP_PIN) return next();
  if (String(req.headers['x-app-pin']) !== String(APP_PIN)) {
    await new Promise(r => setTimeout(r, 1000));
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  next();
};

const requireSecret = async (req: Request, res: Response, next: NextFunction) => {
  if (!SYNC_SECRET) return res.status(500).json({ error: 'No Sync Secret' });
  if (String(req.headers['x-sync-secret']) !== String(SYNC_SECRET)) {
    await new Promise(r => setTimeout(r, 1000));
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Add this NEW middleware below 'requirePin' and 'requireSecret'
const requirePinOrSecret = async (req: Request, res: Response, next: NextFunction) => {
  // 1. Allow if Secret is valid (Server-to-Server)
  if (SYNC_SECRET && req.headers['x-sync-secret'] === String(SYNC_SECRET)) {
    return next();
  }
  // 2. Allow if PIN is valid (User-to-Frontend)
  if (!APP_PIN) return next();
  if (String(req.headers['x-app-pin']) === String(APP_PIN)) {
    return next();
  }

  // 3. Block if neither
  await new Promise(r => setTimeout(r, 1000));
  return res.status(401).json({ error: 'Unauthorized' });
};

// --- HYBRID DOWNLOAD WORKER ---
// 1. Supports Resume (.part files)
// 2. Supports Stall Detection (30s timeout)
// 3. Checks for HTML errors
// --- ROBUST DOWNLOAD LOGIC ---

// Helper: Tries to download ONCE. Returns promise.
const attemptDownload = (remoteUrl: string, remotePath: string, localPath: string, jobId: string, signal: AbortSignal, requesterUser: string) => {
  const cleanBaseUrl = remoteUrl.replace(/\/$/, '');
  const encodedPath = encodeURIComponent(remotePath);
  const downloadUrl = `${cleanBaseUrl}/api/serve?path=${encodedPath}&user=${encodeURIComponent(requesterUser)}`;
  const partPath = `${localPath}.part`;

  // Resume Logic: Check how much we have
  let startByte = 0;
  if (fs.existsSync(partPath)) {
    try { startByte = fs.statSync(partPath).size; } catch (e) { startByte = 0; }
  }

  return new Promise<void>((resolve, reject) => {
    const isHttps = downloadUrl.startsWith('https');
    const lib = isHttps ? https : http;
    const agent = isHttps ? httpsAgent : httpAgent;

    // Manual Stall Detection
    let lastActivity = Date.now();
    const stallInterval = setInterval(() => {
      if (signal.aborted) { clearInterval(stallInterval); return; }
      if (Date.now() - lastActivity > 45000) { // Increased to 45s for stability
        clearInterval(stallInterval);
        reject(new Error("Stalled (No data for 45s)"));
      }
    }, 5000);

    const req = lib.get(downloadUrl, {
      agent,
      headers: {
        'x-sync-secret': SYNC_SECRET || '',
        'Range': `bytes=${startByte}-` // RESUME SUPPORT
      },
      signal
    }, (response) => {
      if (response.statusCode !== 200 && response.statusCode !== 206) {
        clearInterval(stallInterval);
        reject(new Error(`HTTP Status ${response.statusCode}`));
        return;
      }

      if ((response.headers['content-type'] || '').includes('text/html')) {
        clearInterval(stallInterval);
        reject(new Error("Remote sent HTML (Auth error?)"));
        return;
      }

      const contentLength = parseInt(response.headers['content-length'] || '0', 10);
      const totalSize = startByte + contentLength;

      // Update Total Size in UI
      const job = activeDownloads.get(jobId);
      if (job) {
        job.totalBytes = totalSize;
        job.downloadedBytes = startByte;
      }

      const fileStream = fs.createWriteStream(partPath, { flags: startByte > 0 ? 'a' : 'w' });

      let lastTime = Date.now();
      let lastBytes = startByte;

      response.on('data', (chunk) => {
        lastActivity = Date.now();
        const j = activeDownloads.get(jobId);
        if (j) {
          j.downloadedBytes += chunk.length;
          // Calculate Speed
          const now = Date.now();
          if (now - lastTime > 1000) {
            const seconds = (now - lastTime) / 1000;
            j.speed = Math.floor((j.downloadedBytes - lastBytes) / seconds);
            lastTime = now;
            lastBytes = j.downloadedBytes;
          }
        }
      });

      streamPipeline(response, fileStream)
        .then(() => {
          clearInterval(stallInterval);
          resolve();
        })
        .catch(err => {
          clearInterval(stallInterval);
          reject(err);
        });
    });

    req.on('error', err => {
      clearInterval(stallInterval);
      reject(err);
    });
  });
};

// Main Worker: Handles Retries and Loops
const downloadFile = async (remoteUrl: string, remotePath: string, localPath: string, jobId: string) => {
  if (!DOWNLOAD_ROOT) throw new Error("No Download Root");
  if (!SYNC_SECRET) throw new Error("Missing Sync Secret");

  // --- NEW: PRE-FLIGHT DISK CHECK ---
  // Get job details to know the total size (if we have it from a previous attempt)
  const jobInfo = activeDownloads.get(jobId);

  // Only check if we haven't started (status is pending) to avoid spamming checks
  if (jobInfo && jobInfo.status === 'pending') {
    try {
      const space = await checkDiskSpace(DOWNLOAD_ROOT);
      // Safety Buffer: Keep at least 500MB free
      const MIN_FREE_BUFFER = 500 * 1024 * 1024;

      // If we know the total size, check it. (Note: TotalBytes might be 0 if new)
      if (jobInfo.totalBytes > 0 && space.free < (jobInfo.totalBytes - jobInfo.downloadedBytes + MIN_FREE_BUFFER)) {
        throw new Error(`Insufficient Disk Space (Free: ${formatBytes(space.free)})`);
      }

      // If we assume a generic safety check (e.g. stop if < 1GB free regardless)
      if (space.free < 1 * 1024 * 1024 * 1024) {
        throw new Error("Disk dangerously low (<1GB). Download prevented.");
      }
    } catch (e: any) {
      // Fail the job immediately
      activeDownloads.set(jobId, { ...jobInfo, status: 'error', error: e.message });
      return;
    }
  }

  // Skip if already done
  if (fs.existsSync(localPath)) {
    const job = activeDownloads.get(jobId);
    if (job) activeDownloads.set(jobId, { ...job, status: 'skipped', speed: 0 });
    return;
  }

  // Ensure directory exists
  const dir = path.dirname(localPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const controller = new AbortController();
  const activeJob = activeDownloads.get(jobId);
  if (activeJob) {
    activeJob.status = 'downloading';
    activeJob.abortController = controller;
  }

  const MAX_RETRIES = 5;
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    attempt++;
    try {
      await attemptDownload(remoteUrl, remotePath, localPath, jobId, controller.signal, HOST_USER);

      // SUCCESS! Rename .part to actual file
      const partPath = `${localPath}.part`;
      if (fs.existsSync(partPath)) fs.renameSync(partPath, localPath);

      const finalJob = activeDownloads.get(jobId);
      if (finalJob) activeDownloads.set(jobId, { ...finalJob, status: 'completed', speed: 0 });
      return;

    } catch (e: any) {
      // Check if user cancelled manually
      const currentJob = activeDownloads.get(jobId);
      if (!currentJob || currentJob.status === 'cancelled') return;

      // If "AbortError", it was likely a timeout or manual cancel
      if (e.name === 'AbortError') return;

      console.error(`[Download] Attempt ${attempt} failed: ${e.message}`);

      if (attempt >= MAX_RETRIES) {
        // Failed after all retries
        activeDownloads.set(jobId, { ...currentJob, status: 'error', error: e.message });
        throw e;
      } else {
        // WAIT AND RETRY
        // Exponential backoff: 2s, 5s, 10s...
        const waitTime = Math.min(2000 * Math.pow(2.5, attempt - 1), 30000);
        activeDownloads.set(jobId, {
          ...currentJob,
          error: `Retrying in ${Math.ceil(waitTime / 1000)}s... (${e.message})`
        });

        await new Promise(resolve => setTimeout(resolve, waitTime));

        // Reset status to downloading for next attempt
        const retryJob = activeDownloads.get(jobId);
        if (retryJob && retryJob.status !== 'cancelled') {
          activeDownloads.set(jobId, { ...retryJob, status: 'downloading', error: undefined });
        }
      }
    }
  }
};

// --- QUEUE PROCESSOR ---
const processQueue = async () => {
  // If already running or empty, stop
  if (isQueueProcessing) return;
  if (downloadQueue.length === 0) return;

  isQueueProcessing = true;
  const id = downloadQueue.shift(); // Get next job ID

  if (id) {
    const job = activeDownloads.get(id);
    // Only process if valid and not cancelled
    if (job && job.status !== 'cancelled' && job.status !== 'skipped' && job.status !== 'completed') {
      try {
        await downloadFile(job.remoteUrl, job.remotePath, job.localPath, id);
      } catch (e) {
        console.error(`Job ${id} failed in queue.`);
      }
    }
  }

  isQueueProcessing = false;
  processQueue(); // Loop to check for the next item
};

// --- ROUTES ---

app.get('/api/disk', requirePin, async (req, res) => {
  try {
    // Check space on the folder where downloads go
    const space = await checkDiskSpace(DOWNLOAD_ROOT);
    res.json(space); // Returns { diskPath, free, size }
  } catch (e: any) {
    console.error("Disk check error:", e);
    // Fallback if check fails (e.g. on some OS versions)
    res.json({ free: 0, size: 0, error: true });
  }
});

app.get('/api/inventory', requirePin, async (req, res) => {
  try {
    if (!DOWNLOAD_ROOT || !fs.existsSync(DOWNLOAD_ROOT)) {
      return res.json({ complete: [], partials: [] });
    }

    const files = await fs.promises.readdir(DOWNLOAD_ROOT);

    // Identify .part files vs completed files
    const partials = files
      .filter(f => f.endsWith('.part'))
      .map(f => f.replace('.part', '')); // Remove extension to get base name

    const complete = files
      .filter(f => !f.endsWith('.part'));

    res.json({ complete, partials });
  } catch (e: any) {
    console.error("Inventory check failed:", e);
    // Return empty lists on error so frontend doesn't crash
    res.json({ complete: [], partials: [] });
  }
});

app.get('/api/scan-status', requirePin, (req, res) => {
  res.json(globalScanStatus);
});

app.get('/api/uploads', requirePin, (req, res) => {
  const list = Array.from(activeUploads.values()).sort((a, b) => b.startTime - a.startTime);
  res.json(list);
});

app.post('/api/download', requirePin, async (req, res) => {
  const { path: sPath, filename: sName, files, owner, folderName } = req.body;
  let queue: { remotePath: string, filename: string }[] = [];

  if (files && Array.isArray(files)) {
    queue = files.map((f: any) => ({
      remotePath: f.path,
      filename: folderName ? path.join(folderName, f.rawFilename) : f.rawFilename
    }));
  } else if (sPath && sName) {
    queue = [{ remotePath: sPath, filename: sName }];
  } else {
    return res.status(400).json({ error: "Missing params" });
  }

  if (!owner) return res.status(400).json({ error: "Missing owner" });

  const row = db.prepare('SELECT url FROM nodes WHERE owner = ?').get(owner) as { url: string } | undefined;

  if (!row || !row.url) return res.status(404).json({ error: "User node not found" });

  const remoteBaseUrl = row.url;
  const jobIds: string[] = [];

  queue.forEach(item => {
    const id = generateId();
    jobIds.push(id);
    activeDownloads.set(id, {
      id,
      filename: item.filename,
      remoteUrl: remoteBaseUrl,
      remotePath: item.remotePath,
      localPath: path.join(DOWNLOAD_ROOT, item.filename),
      totalBytes: 0,
      downloadedBytes: 0,
      status: 'pending', // IMPORTANT: Starts as 'pending'
      startTime: Date.now(),
      speed: 0
    });

    // NEW: Add to the back of the line!
    downloadQueue.push(id);
  });

  res.json({ success: true, message: `Queued ${queue.length} files.` });

  // NEW: Start the processor if it's sleeping
  processQueue();
});

app.post('/api/download/cancel', requirePin, (req, res) => {
  const { id } = req.body;
  const job = activeDownloads.get(id);
  if (job) {
    if (job.abortController) job.abortController.abort();
    activeDownloads.set(id, { ...job, status: 'cancelled', speed: 0 });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Not found" });
  }
});

app.post('/api/download/retry', requirePin, async (req, res) => {
  const { id } = req.body;
  const job = activeDownloads.get(id);

  if (!job) return res.status(404).json({ error: "Not found" });
  if (job.status === 'downloading') return res.status(400).json({ error: "Busy" });
  // Prevent double-queuing
  if (downloadQueue.includes(id)) return res.status(400).json({ error: "Already queued" });

  activeDownloads.set(id, { ...job, status: 'pending', error: undefined, speed: 0 });

  // NEW: Add to back of queue
  downloadQueue.push(id);
  res.json({ success: true, message: "Re-queued" });

  // NEW: Start processor
  processQueue();
});

app.post('/api/downloads/clear', requirePin, (req, res) => {
  for (const [id, job] of activeDownloads.entries()) {
    if (['completed', 'cancelled', 'error', 'skipped'].includes(job.status)) activeDownloads.delete(id);
  }
  res.json({ success: true });
});

app.get('/api/downloads', requirePin, (req, res) => {
  const list = Array.from(activeDownloads.values()).map(({ abortController, ...r }) => r).sort((a, b) => b.startTime - a.startTime);
  res.json(list);
});

// --- AVATAR ENDPOINT (Proxy Capable) ---
app.get('/api/avatar/:user', async (req, res) => {
  const user = req.params.user;
  const safeUser = user.replace(/[^a-zA-Z0-9_-]/g, ''); 
  
  // 1. HOST MODE: Check local disk first
  // If we have the volume mounted (Master), we serve from disk.
  if (fs.existsSync(AVATAR_ROOT)) {
    const extensions = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
    for (const ext of extensions) {
      const localPath = path.join(AVATAR_ROOT, `${safeUser}.${ext}`);
      if (fs.existsSync(localPath)) {
        return res.sendFile(localPath);
      }
    }
  }

  // 2. CLIENT MODE: Ask the Master
  // If we didn't find it locally, and we have a Master URL, ask them.
  if (MASTER_URL) {
    try {
      // Ensure no trailing slash on Master URL
      const cleanMaster = MASTER_URL.replace(/\/$/, '');
      const targetUrl = `${cleanMaster}/api/avatar/${safeUser}`;
      
      console.log(`[Avatar Proxy] Requesting: ${targetUrl}`); // Debug log

      // Use Node 20 Native Fetch
      const r = await fetch(targetUrl);
      
      if (r.ok) {
        // Forward the content type (image/png, etc.)
        res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
        
        // Convert Web Stream to Buffer and send
        const arrayBuffer = await r.arrayBuffer();
        return res.send(Buffer.from(arrayBuffer));
      } else {
         console.warn(`[Avatar Proxy] Master returned ${r.status}`);
      }
    } catch (e: any) {
      console.error(`[Avatar Proxy] Failed to connect to Master: ${e.message}`);
    }
  }

  // 3. Fallback: 404 (Frontend will show the colored letter badge)
  res.status(404).send('No avatar');
});

// --- STANDARD API ---
app.get('/api/config', (req, res) => res.json({ users: ALLOWED_USERS, requiresPin: !!APP_PIN, hostUser: HOST_USER, canDownload: fs.existsSync(DOWNLOAD_ROOT) }));

app.post('/api/test-connection', requirePin, async (req, res) => {
  try {
    // If this server has a Master URL, try to ping it
    if (MASTER_URL) {
      const response = await fetch(`${MASTER_URL}/api/config`);
      if (!response.ok) throw new Error(`Master responded with ${response.status}`);
      return res.json({ success: true, message: "Connection to Master verified." });
    }

    // If this is a Host (no Master URL), just reply successfully
    res.json({ success: true, message: "Server is online." });
  } catch (e: any) {
    console.error("Test connection failed:", e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/serve', requireSecret, (req, res) => {
  const p = req.query.path as string;
  // NEW: Grab the user from the query param
  const requester = (req.query.user as string) || 'Guest';

  if (!p) return res.status(400).send('Missing path');
  const abs = path.resolve(p);
  const root = path.resolve(MEDIA_ROOT);
  if (!abs.startsWith(root) || !fs.existsSync(abs)) return res.status(404).send('Not found');

  const stat = fs.statSync(abs);
  const fileSize = stat.size;
  const range = req.headers.range;

  // --- NEW: TRACKING LOGIC ---
  const uploadId = generateId();
  activeUploads.set(uploadId, {
    id: uploadId,
    filename: path.basename(abs),
    user: requester,
    transferredBytes: 0,
    totalBytes: fileSize,
    speed: 0,
    startTime: Date.now()
  });

  // Helper to update speed calculations while stream flows
  const attachTracking = (stream: fs.ReadStream) => {
    let lastTime = Date.now();
    let lastBytes = 0;

    stream.on('data', (chunk) => {
      const job = activeUploads.get(uploadId);
      if (job) {
        job.transferredBytes += chunk.length;

        const now = Date.now();
        if (now - lastTime > 1000) {
          const seconds = (now - lastTime) / 1000;
          // Bytes sent since last check / seconds
          job.speed = Math.floor((job.transferredBytes - lastBytes) / seconds);
          lastTime = now;
          lastBytes = job.transferredBytes;
        }
      }
    });

    // Cleanup when done or error
    stream.on('close', () => activeUploads.delete(uploadId));
    stream.on('error', () => activeUploads.delete(uploadId));
  };
  // ---------------------------

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunk = (end - start) + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunk,
      'Content-Type': 'application/octet-stream',
    });
    const stream = fs.createReadStream(abs, { start, end });
    attachTracking(stream); // <--- Attach tracker here
    stream.pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'application/octet-stream' });
    const stream = fs.createReadStream(abs);
    attachTracking(stream); // <--- Attach tracker here
    stream.pipe(res);
  }
});

app.post('/api/scan', requirePin, (req, res) => {
  // 1. Immediate Check: Is a scan already running?
  if (globalScanStatus.isRunning) {
    return res.status(409).json({ error: 'Scan already in progress' });
  }

  // 2. Reset Status
  globalScanStatus = {
    isRunning: true,
    step: 'Starting...',
    localFiles: 0,
    newLocal: 0,
    remoteSummary: [],
    error: null
  };

  // 3. Respond IMMEDIATELY to the browser (The fix!)
  res.json({ success: true, message: "Scan started in background" });

  // 4. Start the heavy work in the background (Async)
  (async () => {
    try {
      // 1. NEW: Snapshot the existing files BEFORE we scan
      // We do this so we can compare "Before" vs "After" to find what's new.
      const existingRows = db.prepare('SELECT path FROM media_files WHERE owner = ?').all(HOST_USER) as { path: string }[];
      const existingPaths = new Set(existingRows.map(r => r.path));

      globalScanStatus.step = 'Scanning Local Files...';
      
      // 2. Run the scanner
      const files = await processFiles(MEDIA_ROOT, HOST_USER);
      
      // 3. NEW: Calculate the "New Files" count
      let addedCount = 0;
      for (const f of files) {
          if (!existingPaths.has(f.path)) {
              addedCount++;
          }
      }
      
      globalScanStatus.newLocal = addedCount;
      globalScanStatus.localFiles = files.length;
      
      // Database Update
      globalScanStatus.step = 'Updating Database...';

      // --- ALWAYS SAVE LOCAL FILES FIRST ---
      await replaceUserFiles(HOST_USER, files);

      if (MASTER_URL) {
        // Satellite Mode: Sync to Master
        globalScanStatus.step = 'Syncing to Master...';

        // Chunking logic for large libraries (prevents payload errors)
        const CHUNK_SIZE = 500;
        for (let i = 0; i < files.length; i += CHUNK_SIZE) {
          const chunk = files.slice(i, i + CHUNK_SIZE);

          // --- FIX: ADD RESET FLAG FOR FIRST CHUNK ---
          const isFirstChunk = (i === 0);

          await fetch(`${MASTER_URL}/api/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-sync-secret': SYNC_SECRET || '' },
            body: JSON.stringify({
              owner: HOST_USER,
              url: NODE_URL,
              files: chunk,
              reset: isFirstChunk // <--- Allows host to wipe old data
            })
          });
        }

        // Fetch updates from Master
        const r = await fetch(`${MASTER_URL}/api/files`, {
          headers: { 'x-sync-secret': SYNC_SECRET || '' }
        });
        const d = await r.json();
        if (d.files) await updateExternalCache(d.files, d.nodes);
        globalScanStatus.remoteSummary.push("Sync completed");
      }

      globalScanStatus.step = 'Complete';
    } catch (e: any) {
      console.error("Scan error:", e);
      globalScanStatus.error = e.message;
      globalScanStatus.step = 'Error';
    } finally {
      // Mark as finished
      globalScanStatus.isRunning = false;
    }
  })();
});

app.get('/api/files', requirePinOrSecret, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT m.*, n.url as remote_url 
      FROM media_files m 
      LEFT JOIN nodes n ON m.owner = n.owner 
      ORDER BY m.filename ASC
    `).all() as any[];

    const files = rows.map(r => ({
      ...r,
      rawFilename: r.filename,
      sizeBytes: r.size_bytes,
      lastModified: r.last_modified,
      remoteUrl: r.remote_url
    }));

    const nodes = db.prepare('SELECT * FROM nodes').all();
    res.json({ files, nodes: nodes || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    // Don't intercept API calls
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not Found' });
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  // Fallback for Dev Mode (so it doesn't crash)
  app.get('/', (req, res) => res.send('Server running. For development, use port 5173.'));
}

cron.schedule('0 * * * *', () => {
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();
  let removed = 0;

  for (const [id, job] of activeDownloads.entries()) {
    // Only remove jobs that are in a "Final" state
    if (['completed', 'error', 'cancelled', 'skipped'].includes(job.status)) {
      // If it started more than 1 hour ago, forget it
      if (now - job.startTime > ONE_HOUR) {
        activeDownloads.delete(id);
        removed++;
      }
    }
  }
  if (removed > 0) console.log(`[GC] Removed ${removed} old download jobs.`);
});

// --- SYNC ENDPOINT ---
app.post('/api/sync', requireSecret, (req, res) => {
  const { owner, url, files, reset } = req.body;
  if (!owner || !Array.isArray(files)) return res.status(400).json({ error: "Invalid data" });

  // 1. Register/Update Node URL
  if (url) registerNode(owner, url);

  // 2. Prepare Statements
  // Note: We use the same ID format as local files (owner:path)
  const insertStmt = db.prepare(`INSERT INTO media_files VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  const transaction = db.transaction(() => {
    // 3. IF this is the first chunk, wipe the user's old data so we don't have duplicates
    if (reset) {
      db.prepare('DELETE FROM media_files WHERE owner = ?').run(owner);
    }

    // 4. Insert the new files
    for (const f of files) {
      // Protect against bad data
      if (!f.path || !f.rawFilename) continue;

      try {
        insertStmt.run(
          `${owner}:${f.path}`, // ID
          owner,
          f.rawFilename,
          f.path,
          f.library || 'Unknown',
          f.quality || '',
          f.sizeBytes || 0,
          f.lastModified || 0
        );
      } catch (e) {
        // Ignore duplicates in case of retry
      }
    }
  });

  try {
    transaction();
    res.json({ success: true, count: files.length });
  } catch (e: any) {
    console.error("Sync error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`ShareList21 running on ${PORT}`));