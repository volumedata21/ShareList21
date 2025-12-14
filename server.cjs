const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
const PORT = 80;

// Configuration
const MEDIA_ROOT = process.env.MEDIA_ROOT || '/media';
const DB_PATH = '/data/plexflash.db';
const APP_PIN = process.env.APP_PIN; 
const ALLOWED_USERS = (process.env.APP_USERS || 'Guest').split(',');
const HOST_USER = process.env.HOST_USER;

// --- DEBUG LOGGING ---
console.log("--- ShareList21 Server Starting ---");
console.log(`User List: ${ALLOWED_USERS.join(', ')}`);
console.log(`Security PIN Set: ${APP_PIN ? 'YES (****)' : 'NO (WARNING: Unsecured)'}`);
console.log(`Host Media Scan User: ${HOST_USER || 'None'}`);
console.log("-----------------------------------");

// Ensure data directory exists
if (!require('fs').existsSync('/data')) {
  require('fs').mkdirSync('/data');
}

// Database Setup
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS media_files (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      filename TEXT NOT NULL,
      path TEXT NOT NULL,
      library TEXT,
      quality TEXT,
      size_bytes INTEGER,
      last_modified INTEGER
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_owner ON media_files(owner)");
  db.run("CREATE INDEX IF NOT EXISTS idx_filename ON media_files(filename)");
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

// --- MIDDLEWARE: Security ---
const requirePin = (req, res, next) => {
  if (!APP_PIN) return next();

  const providedPin = req.headers['x-app-pin'];
  // Loose comparison to handle string/number differences
  if (String(providedPin) !== String(APP_PIN)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid PIN' });
  }
  next();
};

// --- HELPER: Database Operations ---
const wipeAndReplaceUser = (owner, files) => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.run('DELETE FROM media_files WHERE owner = ?', [owner]);
      const stmt = db.prepare(`
        INSERT INTO media_files (id, owner, filename, path, library, quality, size_bytes, last_modified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      try {
        files.forEach(f => {
          const uniqueId = `${owner}:${f.path}`;
          stmt.run(uniqueId, owner, f.rawFilename, f.path, f.library, f.quality, f.sizeBytes, f.lastModified);
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

// --- HELPER: Host Scanning ---
async function scanHostFolder() {
  if (!HOST_USER) return;
  console.log(`[Host Scan] Scanning local folders for user: ${HOST_USER}...`);
  
  const getFiles = async (dir) => {
    try {
      const dirents = await fs.readdir(dir, { withFileTypes: true });
      const files = await Promise.all(dirents.map((dirent) => {
        const res = path.resolve(dir, dirent.name);
        return dirent.isDirectory() ? getFiles(res) : res;
      }));
      return Array.prototype.concat(...files);
    } catch (e) { 
      // console.error(`Access denied: ${dir}`); 
      return []; 
    }
  };

  try {
    const filePaths = await getFiles(MEDIA_ROOT);
    const mediaFiles = [];
    // UPDATED: Added more music extensions
    const validExts = ['.mkv', '.mp4', '.avi', '.mov', '.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg'];
    
    for (const filePath of filePaths) {
      const ext = path.extname(filePath).toLowerCase();
      if (!validExts.includes(ext)) continue;

      const stats = await fs.stat(filePath);
      const relativePath = path.relative(MEDIA_ROOT, filePath);
      
      mediaFiles.push({
        rawFilename: path.basename(filePath),
        path: relativePath,
        library: relativePath.split(path.sep)[0],
        quality: path.basename(filePath).match(/4k|1080p|720p/i)?.[0] || null,
        sizeBytes: stats.size,
        lastModified: stats.mtimeMs
      });
    }

    await wipeAndReplaceUser(HOST_USER, mediaFiles);
    console.log(`[Host Scan] Complete. Synced ${mediaFiles.length} files for ${HOST_USER}.`);
  } catch (err) {
    console.error("[Host Scan] Error:", err);
  }
}

setTimeout(scanHostFolder, 2000);
setInterval(scanHostFolder, 1000 * 60 * 60 * 24);

// --- API ROUTES ---

app.get('/api/config', (req, res) => {
  // Always return current PIN status
  res.json({
    users: ALLOWED_USERS,
    requiresPin: !!APP_PIN
  });
});

app.post('/api/sync', requirePin, async (req, res) => {
  const { owner, files } = req.body;
  if (!ALLOWED_USERS.includes(owner)) return res.status(403).json({ error: 'User not allowed' });

  try {
    await wipeAndReplaceUser(owner, files);
    console.log(`[Remote Sync] Synced ${files.length} files for ${owner}`);
    res.json({ success: true, count: files.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/files', requirePin, (req, res) => {
  db.all('SELECT * FROM media_files ORDER BY filename ASC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    
    // Normalize DB rows to frontend format
    const cleanRows = rows.map(r => ({
      ...r,
      // CRITICAL FIX: Map DB 'filename' to Frontend 'rawFilename'
      rawFilename: r.filename, 
      
      // Ensure numeric types are numbers
      sizeBytes: r.size_bytes, 
      lastModified: r.last_modified
    }));
    
    res.json(cleanRows);
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Scanning directory: ${MEDIA_ROOT}`);
});