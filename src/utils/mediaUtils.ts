// src/utils/mediaUtils.ts

// --- FORMATTERS ---

export const formatBytes = (bytes: number, decimals = 2): string => {
  if (!bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

/**
 * INTELLIGENT NAME CLEANER
 * 1. Year Anchor: If (YYYY) exists, keep it and discard everything after.
 * 2. Tech Cleanup: If no year, strip technical jargon but keep the title.
 */
export const cleanName = (filename: string): string => {
  if (!filename) return '';

  // 1. Remove file extension
  let name = filename.replace(/\.[^/.]+$/, "");

  // 2. YEAR ANCHOR STRATEGY (Movies)
  // Look for the year pattern (YYYY). 
  // We strictly want to KEEP the year, but discard what comes AFTER it.
  const yearMatch = name.match(/^(.*?)(\(\d{4}\))/);
  
  if (yearMatch) {
    // yearMatch[1] = Title ("Legoland ")
    // yearMatch[2] = Year ("(2026)")
    // We combine them and ignore the rest of the string (the trash)
    name = `${yearMatch[1]}${yearMatch[2]}`;
  } 
  else {
    // 3. NO YEAR STRATEGY (TV Shows / Misc)
    // If no year, we rely on the " - " separator or Bracket cleanup.

    // Remove [brackets] and {braces} entirely
    name = name.replace(/\[.*?\]/g, "").replace(/\{.*?\}/g, "");

    // Conditional Dash Logic:
    // Only split at " - " if the part AFTER the dash is tech info.
    if (name.includes(' - ')) {
      const parts = name.split(' - ');
      const lastPart = parts[parts.length - 1].toLowerCase();
      
      // Terms that indicate the suffix is just metadata, not part of the title
      const techTerms = ['4k', '1080p', '720p', '2160p', 'remux', 'bluray', 'web-dl', 'hevc', 'hdr', 'dvd', 'rip'];
      const isTechSuffix = techTerms.some(t => lastPart.includes(t));

      if (isTechSuffix) {
        parts.pop(); // Remove the tech suffix
        name = parts.join(' - ');
      }
    }
  }

  // 4. General Cleanup (Applies to both strategies)
  
  // Remove dots/underscores (but keep dashes as they might be part of the title)
  name = name.replace(/[._]/g, " ");

  // Final whitespace polish
  return name.trim();
};

// --- CORE DETECTION LOGIC ---

export const getMediaType = (path: string, filename: string): 'Movie' | 'TV Show' | 'Music' | 'Unknown' => {
  const lowerName = filename.toLowerCase();
  // Normalize path separators to forward slashes for consistent regex
  const lowerPath = path.toLowerCase().replace(/\\/g, '/'); 

  // 1. Check Extensions
  const isAudio = /\.(mp3|flac|wav|m4a|aac|ogg|wma|alac|aiff|ape|opus)$/.test(lowerName);
  const isVideo = /\.(mkv|mp4|avi|mov|wmv|m4v|ts|iso)$/.test(lowerName);

  if (!isAudio && !isVideo) return 'Unknown';

  // 2. Audio is usually Music
  if (isAudio) return 'Music';

  // 3. Explicit Folder Detection (Matches your new Scanner.ts)
  if (/\/movies\//.test(lowerPath)) return 'Movie';
  if (/\/tv\//.test(lowerPath) || /\/tvshows\//.test(lowerPath)) return 'TV Show';
  if (/\/music\//.test(lowerPath)) return 'Music';

  // 4. Fallback: TV Detection via Filename (S01E01)
  if (/s\d{1,2}e\d{1,2}/i.test(lowerName) || /\d{1,2}x\d{1,2}/.test(lowerName)) {
    return 'TV Show';
  }

  // 5. Default Fallback
  return 'Movie';
};

// --- METADATA EXTRACTORS ---

export const getMusicMetadata = (pathStr: string) => {
  const parts = pathStr.replace(/\\/g, '/').split('/');
  const len = parts.length;
  
  // Strategy: Look for "Music" folder, otherwise guess based on depth
  const musicIdx = parts.findIndex(p => p.toLowerCase() === 'music');

  if (musicIdx !== -1 && musicIdx + 2 < len) {
    return { artist: parts[musicIdx + 1], album: parts[musicIdx + 2] };
  } 
  
  // Fallback: Assume structure is .../Artist/Album/Song.mp3
  if (len >= 3) {
    return { artist: parts[len - 3], album: parts[len - 2] };
  }

  return { artist: 'Unknown Artist', album: 'Unknown Album' };
};

export const getSeriesName = (filename: string): string | null => {
  // Matches "Breaking.Bad.S01E01" -> "Breaking Bad"
  // We use cleanName here to ensure dots are removed
  const match = filename.match(/(.*?)[._\s-]*(s\d{1,2}e\d{1,2}|\d{1,2}x\d{1,2})/i);
  if (match && match[1]) {
    return cleanName(match[1]);
  }
  return null;
};

export const parseEpisodeInfo = (filename: string) => {
  const match = filename.match(/s(\d{1,2})e(\d{1,2})/i);
  if (match) {
    return {
      season: parseInt(match[1], 10),
      episode: parseInt(match[2], 10),
      full: `S${match[1].padStart(2, '0')}E${match[2].padStart(2, '0')}`
    };
  }
  return null;
};

export const getEpisodeTitle = (filename: string): string => {
  // Grab text AFTER S01E01
  const match = filename.match(/s\d{1,2}e\d{1,2}[._\s-]*(.*?)(\.(mkv|mp4|avi)|$)/i);
  if (match && match[1]) {
     // We simply replace dots with spaces here, avoiding the aggressive Movie cleaner
     return match[1].replace(/[._]/g, " ").trim();
  }
  return '';
};

// --- FORMAT FLAGS ---

export const get3DFormat = (filename: string): string | null => {
  const lower = filename.toLowerCase();
  if (lower.includes('.sbs') || lower.includes('h-sbs')) return '3D SBS';
  if (lower.includes('.hou') || lower.includes('h-ou')) return '3D OU';
  if (lower.includes('3d')) return '3D';
  return null;
};

export const get4KFormat = (filename: string): boolean => {
  return /2160p|4k|uhd/i.test(filename);
};

export const is4KQualityString = (quality: string | undefined): boolean => {
  return !!quality && /2160p|4k|uhd/i.test(quality);
};

export const getRemuxFormat = (filename: string): string | null => {
  const lower = filename.toLowerCase();
  if (!lower.includes('remux')) return null;

  if (lower.includes('4k') || lower.includes('2160p')) return 'REMUX-4K';
  if (lower.includes('1080p')) return 'REMUX-1080';
  return 'REMUX';
};

export const getAudioFormat = (filename: string): string | null => {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'flac') return 'FLAC';
  if (ext === 'wav') return 'WAV';
  if (ext === 'aac') return 'AAC';
  if (ext === 'ac3') return 'DD';
  if (ext === 'dts') return 'DTS';
  if (ext === 'opus') return 'OPUS';
  return null;
};

export const fuzzyMatch = (text: string, query: string): boolean => {
  if (!text || !query) return false;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  return t.includes(q);
};