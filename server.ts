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

const ALLOWED_USERS = (process.env.APP_USERS || 'Guest').split(',');
const HOST_USER = process.env.HOST_USER; 
const MEDIA_ROOT = process.env.MEDIA_ROOT || '/media';

if (!fs.existsSync('/data')) fs.mkdirSync('/data');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error("Database connection error:", err.message);
  else console.log("Connected to SQLite database at", DB_PATH);
});

// --- NEW CLEANUP LOGIC ---
const cleanupOrphanedUsers = () => {
  if (ALLOWED_USERS.length === 0) return;

  // Create placeholders for SQL (e.g., "?, ?, ?")
  const placeholders = ALLOWED_USERS.map(() => '?').join(',');
  
  // Delete anyone NOT in the ALLOWED_USERS list
  const query = `DELETE FROM media_files WHERE owner NOT IN (${placeholders})`;
  
  db.run(query, ALLOWED_USERS, function(err) {
    if (err) {
      console.error("[Cleanup] Failed to prune orphaned users:", err.message);
    } else if (this.changes > 0) {
      console.log(`[Cleanup] Removed ${this.changes} files belonging to removed users.`);
      console.log(`[Cleanup] Valid Users are: ${ALLOWED_USERS.join(', ')}`);
    }
  });
};
// -------------------------

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS media_files (
    id TEXT PRIMARY KEY, owner TEXT, filename TEXT, path TEXT, 
    library TEXT, quality TEXT, size_bytes INTEGER, last_modified INTEGER
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_owner ON media_files(owner)");
  
  // Run cleanup on startup
  cleanupOrphanedUsers();
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../dist')));

// --- RATE LIMITING & AUTH MIDDLEWARE ---

interface LockoutState { attempts: number; lockoutUntil: number | null; }
const ipLockouts = new Map<string, LockoutState>();

const requirePin = (req: Request, res: Response, next: NextFunction) => {
  if (!APP_PIN) return next();

  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
  const state = ipLockouts.get(ip) || { attempts: 0, lockoutUntil: null };

  if (state.lockoutUntil && Date.now() < state.lockoutUntil) {
    const timeLeft = Math.ceil((state.lockoutUntil - Date.now()) / 1000);
    res.status(429).json({ error: `Too many attempts. Try again in ${timeLeft}s` });
    return;
  }

  const provided = req.headers['x-app-pin'];
  if (String(provided) !== String(APP_PIN)) {
     state.attempts += 1;
     if (state.attempts >= 5) state.lockoutUntil = Date.now() + (30 * 1000);
     ipLockouts.set(ip, state);
     res.status(401).json({ error: 'Invalid PIN' });
     return;
  }

  if (state.attempts > 0) ipLockouts.delete(ip);
  next();
};

const requireSecret = (req: Request, res: Response, next: NextFunction) => {
  if (!SYNC_SECRET) {
    console.error("[Security] SYNC_SECRET not set on server. Rejecting /api/sync request.");
    res.status(500).json({ error: 'Server misconfiguration: No Sync Secret set.' });
    return;
  }
  const providedSecret = req.headers['x-sync-secret'];
  if (String(providedSecret) !== String(SYNC_SECRET)) {
     console.warn(`[Security] Invalid Sync Secret attempt from ${req.ip}`);
     res.status(401).json({ error: 'Unauthorized' }); 
     return;
  }
  next();
};

const wipeAndReplaceUser = (owner: string, files: MediaFile[]): Promise<void> => {
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

// --- ROUTES ---

app.get('/api/config', (req, res) => {
  res.json({ 
    users: ALLOWED_USERS, 
    requiresPin: !!APP_PIN,
    hostUser: HOST_USER
  });
});

app.post('/api/scan', requirePin, async (req, res) => {
  const owner = req.body.owner || HOST_USER;
  if (owner !== HOST_USER) {
    res.status(403).json({ error: 'Only the Host User can trigger manual scans via the web UI.' });
    return;
  }
  try {
    if (!fs.existsSync(MEDIA_ROOT)) throw new Error(`Media folder ${MEDIA_ROOT} not found.`);
    const files = await processFiles(MEDIA_ROOT, owner);
    await wipeAndReplaceUser(owner, files);
    res.json({ success: true, count: files.length });
  } catch (e: any) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sync', requireSecret, async (req, res) => {
  const { owner, files } = req.body as SyncPayload;
  if (!ALLOWED_USERS.includes(owner)) {
    res.status(403).json({ error: 'User not allowed' });
    return;
  }
  try {
    await wipeAndReplaceUser(owner, files);
    console.log(`[API] Synced ${files.length} files for ${owner}`);
    res.json({ success: true, count: files.length });
  } catch (err: any) { 
    console.error("Sync Error:", err);
    res.status(500).json({ error: err.message }); 
  }
});

app.get('/api/files', requirePin, (req, res) => {
  db.all('SELECT * FROM media_files ORDER BY filename ASC', (err, rows: any[]) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    res.json(rows.map(r => ({ ...r, rawFilename: r.filename })));
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist', 'index.html'));
});

if (HOST_USER) {
  const runHostScan = async () => {
    try {
      if (fs.existsSync(MEDIA_ROOT)) {
         console.log("[Auto Scan] Scanning host library...");
         const files = await processFiles(MEDIA_ROOT, HOST_USER);
         await wipeAndReplaceUser(HOST_USER, files);
         console.log(`[Auto Scan] Complete. ${files.length} files.`);
      }
    } catch (e) { console.error("[Auto Scan Error]", e); }
  };
  setTimeout(runHostScan, 5000); 
  cron.schedule('0 3 * * *', runHostScan);
}

app.listen(PORT, '0.0.0.0', () => console.log(`ShareList21 Server running on ${PORT}`));