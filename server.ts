import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import pkg from 'sqlite3';
import cors from 'cors';
import cron from 'node-cron';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { processFiles } from './scanner';
import { MediaFile, SyncPayload } from './types';

const { verbose } = pkg; 
const sqlite3 = verbose();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 80;

const DB_PATH = '/data/sharelist.db';
const APP_PIN = process.env.APP_PIN; 
const SYNC_SECRET = process.env.SYNC_SECRET;

// CONFIGURATION
const MASTER_URL = process.env.MASTER_URL; 
const HOST_USER = process.env.HOST_USER || 'Guest'; 
const MEDIA_ROOT = process.env.MEDIA_ROOT || '/media';
// NEW: Configurable Schedule (Defaults to 3 AM if missing)
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 3 * * *';

const ALLOWED_USERS = (process.env.APP_USERS || 'Guest').split(',').map(u => u.trim());

if (!fs.existsSync('/data')) fs.mkdirSync('/data');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error("Database connection error:", err.message);
  else console.log(`Connected to SQLite DB. Running as user: ${HOST_USER}`);
});

// --- DB HELPERS ---

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

const updateExternalCache = (files: MediaFile[]): Promise<void> => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.run('DELETE FROM media_files WHERE owner != ?', [HOST_USER]);
      
      const stmt = db.prepare(`INSERT INTO media_files VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      try {
        files.forEach(f => {
          if (f.owner !== HOST_USER) {
            stmt.run(`${f.owner}:${f.path}`, f.owner, f.rawFilename, f.path, f.library, f.quality, f.sizeBytes, f.lastModified);
          }
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

const cleanupOrphanedUsers = () => {
  if (MASTER_URL) return; 
  if (ALLOWED_USERS.length === 0) return;
  const placeholders = ALLOWED_USERS.map(() => '?').join(',');
  const query = `DELETE FROM media_files WHERE owner NOT IN (${placeholders})`;
  db.run(query, ALLOWED_USERS, (err) => { if (err) console.error(err); });
};

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY, owner TEXT, filename TEXT, path TEXT, 
    library TEXT, quality TEXT, size_bytes INTEGER, last_modified INTEGER
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_owner ON media_files(owner)");
  cleanupOrphanedUsers();
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../dist')));

// --- MIDDLEWARE ---
const requirePin = (req: Request, res: Response, next: NextFunction) => {
  if (!APP_PIN) return next();
  const provided = req.headers['x-app-pin'];
  if (String(provided) !== String(APP_PIN)) {
     return res.status(401).json({ error: 'Invalid PIN' });
  }
  next();
};

const requireSecret = (req: Request, res: Response, next: NextFunction) => {
  if (!SYNC_SECRET) return res.status(500).json({ error: 'No Sync Secret set.' });
  if (String(req.headers['x-sync-secret']) !== String(SYNC_SECRET)) {
     return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// --- CORE SYNC LOGIC ---

const performLocalScan = async () => {
  if (!fs.existsSync(MEDIA_ROOT)) {
    console.warn(`[Scanner] Media folder ${MEDIA_ROOT} not found. Skipping.`);
    return [];
  }
  console.log(`[Scanner] Scanning local media for ${HOST_USER}...`);
  const files = await processFiles(MEDIA_ROOT, HOST_USER);
  await replaceUserFiles(HOST_USER, files); 
  console.log(`[Scanner] Local DB updated with ${files.length} files.`);
  return files;
};

const syncWithMaster = async (localFiles: MediaFile[]) => {
  if (!MASTER_URL) return; 

  console.log(`[Sync] Connecting to Master: ${MASTER_URL}`);

  try {
    // 1. Push
    const pushRes = await fetch(`${MASTER_URL}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-secret': SYNC_SECRET || '' },
      body: JSON.stringify({ owner: HOST_USER, files: localFiles })
    });
    if (!pushRes.ok) throw new Error(`Push failed: ${pushRes.statusText}`);
    console.log("[Sync] Push successful.");

    // 2. Pull
    const pullRes = await fetch(`${MASTER_URL}/api/files`, {
      headers: { 'x-app-pin': APP_PIN || '' } 
    });
    if (!pullRes.ok) throw new Error(`Pull failed: ${pullRes.statusText}`);
    
    const masterFiles: MediaFile[] = await pullRes.json();
    await updateExternalCache(masterFiles);
    console.log(`[Sync] Pull successful. Cache updated with ${masterFiles.length} remote items.`);

  } catch (err: any) {
    console.error(`[Sync Error] Could not reach Master: ${err.message}. Running in Offline Mode.`);
    throw err; 
  }
};

// --- ROUTES ---

app.get('/api/config', (req, res) => {
  res.json({ 
    users: ALLOWED_USERS, 
    requiresPin: !!APP_PIN,
    hostUser: HOST_USER
  });
});

// MAIN SCAN ENDPOINT
app.post('/api/scan', requirePin, async (req, res) => {
  const owner = req.body.owner;

  // Master "Scan All" Logic
  if (owner === 'ALL' && !MASTER_URL) {
    try {
      await performLocalScan();
      res.json({ success: true, message: "Local Library Scanned. Remote clients must sync themselves." });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
    return;
  }

  // Satellite Logic
  try {
    const files = await performLocalScan();
    if (MASTER_URL) {
      await syncWithMaster(files);
    }
    res.json({ success: true, count: files.length, message: "Sync Complete." });
  } catch (e: any) {
    console.error(e);
    res.json({ success: true, count: 0, message: "Local scan done, but Master sync failed. Showing local files only." });
  }
});

// INCOMING SYNC (Master receives data)
app.post('/api/sync', requireSecret, async (req, res) => {
  const { owner, files } = req.body as SyncPayload;
  
  if (MASTER_URL) {
    res.status(400).json({ error: "I am a Satellite, not the Master." });
    return;
  }

  if (!ALLOWED_USERS.includes(owner)) {
    res.status(403).json({ error: 'User not allowed' });
    return;
  }

  try {
    await replaceUserFiles(owner, files);
    console.log(`[API] Master DB received ${files.length} files from ${owner}`);
    res.json({ success: true });
  } catch (err: any) { 
    res.status(500).json({ error: err.message }); 
  }
});

app.get('/api/files', requirePin, (req, res) => {
  db.all('SELECT * FROM media_files ORDER BY filename ASC', (err, rows: any[]) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    const files = rows.map(r => ({ 
      ...r, 
      rawFilename: r.filename, 
      sizeBytes: r.size_bytes, 
      lastModified: r.last_modified 
    }));
    res.json(files);
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist', 'index.html'));
});

// --- AUTOMATION ---
const scheduledScan = async () => {
  console.log(`[Cron] Starting scheduled scan at ${new Date().toISOString()}`);
  const files = await performLocalScan();
  try { await syncWithMaster(files); } catch(e) {} 
};

// Start Up Scan
setTimeout(scheduledScan, 5000); 

// Cron Schedule
if (cron.validate(CRON_SCHEDULE)) {
  cron.schedule(CRON_SCHEDULE, scheduledScan);
  console.log(`[Cron] Scheduled scans enabled: ${CRON_SCHEDULE}`);
} else {
  console.error(`[Cron] Invalid Schedule: ${CRON_SCHEDULE}`);
}

app.listen(PORT, '0.0.0.0', () => console.log(`ShareList21 Server (${MASTER_URL ? 'Satellite' : 'Master'}) running on ${PORT}`));