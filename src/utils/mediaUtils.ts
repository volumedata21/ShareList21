export const formatBytes = (bytes: number, decimals = 2): string => {
  if (!bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

export const getMediaType = (path: string, filename: string): 'Movie' | 'TV Show' | 'Music' | 'Unknown' => {
  const normalizedPath = path.toLowerCase().replace(/\\/g, '/');
  const parts = normalizedPath.split('/');
  const lowerName = filename.toLowerCase();

  const isAudio = /\.(mp3|flac|wav|m4a|aac|ogg|wma|alac|aiff|ape|opus)$/.test(lowerName);
  const isVideo = /\.(mkv|mp4|avi|mov|wmv|m4v|ts|iso)$/.test(lowerName);

  if (parts.includes('music') && isAudio) {
    return 'Music';
  }

  if ((parts.includes('tv') || parts.includes('shows')) && isVideo) {
    return 'TV Show';
  }

  if (parts.includes('movies') && isVideo) {
    return 'Movie';
  }

  if (isVideo) {
     if (/s\d{2}e\d{2}/.test(lowerName)) return 'TV Show';
     return 'Movie';
  }
  
  return 'Unknown';
};

export const getAudioFormat = (filename: string): string | null => {
  const match = filename.match(/\.(mp3|flac|wav|m4a|aac|ogg|wma|alac|aiff|ape|opus)$/i);
  if (match) {
    return match[1].toUpperCase();
  }
  return null;
};

export const getMusicMetadata = (path: string) => {
  const normalizedPath = path.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');
  
  const musicIdx = parts.findIndex(p => p.toLowerCase() === 'music');
  
  if (musicIdx !== -1 && musicIdx + 2 < parts.length) {
    return {
      artist: parts[musicIdx + 1],
      album: parts[musicIdx + 2]
    };
  } else if (musicIdx !== -1 && musicIdx + 1 < parts.length) {
     return {
       artist: parts[musicIdx + 1],
       album: 'Unknown Album'
     };
  }
  
  return { artist: 'Unknown Artist', album: 'Unknown Album' };
};

export const get3DFormat = (filename: string): string | null => {
  const lower = filename.toLowerCase();
  if (lower.includes('.sbs') || lower.includes('h-sbs')) return '3D SBS';
  if (lower.includes('.hou') || lower.includes('h-ou')) return '3D OU';
  if (lower.includes('.3d.') || lower.includes(' 3d ')) return '3D';
  return null;
};

export const get4KFormat = (filename: string): boolean => {
  const lower = filename.toLowerCase();
  return lower.includes('4k') || lower.includes('2160p') || lower.includes('uhd');
};

// NEW: Detect REMUX and pair with resolution
export const getRemuxFormat = (filename: string): string | null => {
  const lower = filename.toLowerCase();
  if (!lower.includes('remux')) return null;

  if (lower.includes('4k') || lower.includes('2160p')) return 'REMUX-4K';
  if (lower.includes('1080p')) return 'REMUX-1080';
  if (lower.includes('720p')) return 'REMUX-720';
  if (lower.includes('480p')) return 'REMUX-480';
  
  return 'REMUX'; // Fallback if no resolution found
};

export const is4KQualityString = (quality: string | null): boolean => {
  if (!quality) return false;
  const lower = quality.toLowerCase();
  return ['4k', '2160p', 'uhd', '4k uhd'].includes(lower);
};

export const cleanName = (filename: string): string => {
  if (!filename) return '';

  // 1. Remove the file extension (e.g., .mkv, .mp4)
  let name = filename.replace(/\.[^/.]+$/, "");

  // 2. AGGRESSIVE: Remove anything inside square brackets entirely [ ... ]
  // The regex \[.*?\] matches '[' followed by any characters until the first ']'
  name = name.replace(/\[.*?\]/g, "");

  // 3. Remove common metadata patterns that might act as suffixes (outside of brackets)
  // This handles " - 1080p", " (1080p)", etc.
  const metaPatterns = [
    /\s?-\s?\d{3,4}p/i,       // - 1080p
    /\s?\(\d{3,4}p\)/i,       // (1080p)
    /\s?-\s?4k/i,             // - 4k
    /\s?uhd/i,                // uhd
    /\s?bluray/i,             // bluray
    /\s?web-dl/i,             // web-dl
    /\s?remux/i,              // remux
    /\s?h\.?26[45]/i,         // h.264 or h265
    /\s?hevc/i,               // hevc
    /\s?10bit/i,              // 10bit
    /\s?hdr\d*/i,             // hdr, hdr10
    /\s?aac/i,                // aac
    /\s?ac3/i,                // ac3
    /\s?dts/i,                // dts
    /\s?5\.1/i,               // 5.1
    /\s?7\.1/i,               // 7.1
  ];

  metaPatterns.forEach(pattern => {
    name = name.replace(pattern, "");
  });

  // 4. Cleanup: Remove trailing dashes, dots, or double spaces left behind
  name = name.replace(/\s{2,}/g, " "); // Turn double spaces into single
  name = name.replace(/[-.]+$/, "");    // Remove trailing dash or dot
  
  return name.trim();
};

export const fuzzyMatch = (text: string, query: string): boolean => {
  const lowerText = text.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
  return terms.every(term => lowerText.includes(term));
};

export const getSeriesName = (filename: string): string | null => {
  const match = filename.match(/(.+?)\s*s\d{2}e\d{2}/i);
  if (match) return cleanName(match[1]);
  return null;
};

export const parseEpisodeInfo = (filename: string) => {
  const match = filename.match(/s(\d{2})e(\d{2})/i);
  if (match) {
    return {
      season: parseInt(match[1]),
      episode: parseInt(match[2]),
      full: match[0].toUpperCase()
    };
  }
  return null;
};

export const getEpisodeTitle = (filename: string): string => {
  const match = filename.match(/s\d{2}e\d{2}[\s.]+(?:-[\s.]+)?(.+)\.\w+$/i);
  if (match) return cleanName(match[1]);
  return "";
};