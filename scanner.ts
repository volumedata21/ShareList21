import fs from 'fs/promises';
import path from 'path';
import { MediaFile } from './src/types';
import pLimit from 'p-limit';

// --- CONFIGURATION ---

// Extensions
const VIDEO_EXTS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.iso', '.ts', '.m4v'
]);

const AUDIO_EXTS = new Set([
  '.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.wma', '.alac', '.aiff', '.ape', '.opus'
]);

// 1. SYSTEM IGNORE: Always ignore these everywhere
const SYSTEM_IGNORE = new Set([
  '@eadir', '.git', '.ds_store', '#recycle', 'system volume information', 'lost+found'
]);

// 2. MOVIE IGNORE: Strict cleanup for Movie folders
// We ignore "extras" here because we don't want them showing up as separate movies.
const MOVIE_DIR_IGNORE = new Set([
  'extras', 'extra', 'featurettes', 'featurette',
  'interviews', 'interview', 'scenes', 'scene',
  'shorts', 'short', 'trailers', 'trailer',
  'deletedscenes', 'deleted', 'behindthescenes', 'bts',
  'bonus', 'bonuses', 'samples', 'sample'
]);

// 3. TV IGNORE: Lighter cleanup for TV
// Note: We DO NOT ignore "Specials" or "Season 0" here.
const TV_DIR_IGNORE = new Set([
  'featurettes', 'interview', 'deleted', 'trailers'
]);

// --- HELPERS ---

const normalize = (name: string) => name.toLowerCase().replace(/[\s\-_]/g, '');

async function getStats(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch (e) {
    return null;
  }
}

// --- SCANNING LOGIC ---

/**
 * Recursively scans a directory with specific rules based on the 'type'
 */
async function scanRecursively(dir: string, type: 'movies' | 'tv' | 'music'): Promise<string[]> {
  let results: string[] = [];
  
  try {
    const dirents = await fs.readdir(dir, { withFileTypes: true });

    for (const dirent of dirents) {
      const name = dirent.name;
      const lowerName = name.toLowerCase();
      const res = path.resolve(dir, name);

      // 1. Global System Checks
      if (name.startsWith('.') || name.startsWith('_')) continue;
      if (SYSTEM_IGNORE.has(lowerName)) continue;

      if (dirent.isDirectory()) {
        const normalized = normalize(name);

        // 2. Category-Specific Ignore Rules
        if (type === 'movies') {
          if (MOVIE_DIR_IGNORE.has(normalized)) continue;
        } else if (type === 'tv') {
          if (TV_DIR_IGNORE.has(normalized)) continue;
        }
        // (Music has no special folder ignore rules, just recurses)

        results = results.concat(await scanRecursively(res, type));

      } else {
        // 3. File Extension Checks
        const ext = path.extname(name).toLowerCase();

        if (type === 'music') {
          if (AUDIO_EXTS.has(ext)) results.push(res);
        } else {
          // Movies & TV
          if (VIDEO_EXTS.has(ext)) {
            // Check for tiny sample files ( < 50MB ) and skip them
            if (lowerName.includes('sample')) {
               const s = await getStats(res);
               if (s && s.size < 50 * 1024 * 1024) continue;
            }
            results.push(res);
          }
        }
      }
    }
  } catch (e) {
    // console.warn(`Could not access ${dir}:`, e);
  }
  return results;
}

// --- MAIN PROCESSOR ---

export async function processFiles(mediaRoot: string, owner: string): Promise<MediaFile[]> {
  const absoluteRoot = path.resolve(mediaRoot);
  console.log(`[Scanner] Starting strict scan of ${absoluteRoot} for user ${owner}...`);

  const allFilePaths: { path: string, library: string }[] = [];

  // 1. Scan /media/movies
  const movieDir = path.join(absoluteRoot, 'movies');
  // We check for 'movies' (plural) as the standard
  try {
    await fs.access(movieDir);
    const files = await scanRecursively(movieDir, 'movies');
    files.forEach(f => allFilePaths.push({ path: f, library: 'Movies' }));
  } catch (e) { /* Folder doesn't exist, skip */ }

  // 2. Scan /media/tv (or /media/tvshows)
  let tvDir = path.join(absoluteRoot, 'tv');
  try {
    await fs.access(tvDir);
  } catch (e) {
    // Fallback: try 'tvshows' if 'tv' doesn't exist
    tvDir = path.join(absoluteRoot, 'tvshows');
  }

  try {
    await fs.access(tvDir);
    const files = await scanRecursively(tvDir, 'tv');
    files.forEach(f => allFilePaths.push({ path: f, library: 'TV Shows' }));
  } catch (e) { /* Folder doesn't exist, skip */ }

  // 3. Scan /media/music
  const musicDir = path.join(absoluteRoot, 'music');
  try {
    await fs.access(musicDir);
    const files = await scanRecursively(musicDir, 'music');
    files.forEach(f => allFilePaths.push({ path: f, library: 'Music' }));
  } catch (e) { /* Folder doesn't exist, skip */ }

  // --- BATCH PROCESSING (STATS) ---
  
  // Use p-limit to prevent "Too Many Open Files" error
  const limit = pLimit(50);

  const tasks = allFilePaths.map((item) => {
    return limit(async () => {
      try {
        const stats = await fs.stat(item.path);
        const filename = path.basename(item.path);
        
        // Quality Detection
        let quality = filename.match(/4k|2160p|1080p|720p|sd/i)?.[0] || '';
        if (/\{edition-3d\}|\.sbs/i.test(filename)) {
          quality = '3D';
        }

        return {
          rawFilename: filename,
          path: item.path,
          library: item.library, // Now strictly 'Movies', 'TV Shows', or 'Music'
          quality: quality,
          owner: owner,
          sizeBytes: stats.size,
          lastModified: stats.mtimeMs
        } as MediaFile;
      } catch (e) { return null; }
    });
  });

  const results = await Promise.all(tasks);
  const validFiles = results.filter((f): f is MediaFile => f !== null);

  console.log(`[Scanner] Scan complete. Found: 
    Movies: ${validFiles.filter(f => f.library === 'Movies').length}
    TV Ep:  ${validFiles.filter(f => f.library === 'TV Shows').length}
    Music:  ${validFiles.filter(f => f.library === 'Music').length}
  `);
  
  return validFiles;
}