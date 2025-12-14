import { MediaItem, MediaType } from '../types';

// Extensions to ignore
const IGNORED_EXTENSIONS = new Set(['srt', 'nfo', 'txt', 'jpg', 'png', 'jpeg', 'tbn', 'db', 'ini', 'plexignore']);
const VIDEO_EXTENSIONS = new Set(['mkv', 'mp4', 'avi', 'mov', 'wmv', 'm4v', 'webm']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'wav', 'aac', 'm4a', 'ogg', 'alac']);

export const isMediaFile = (filename: string): boolean => {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return false;
  return VIDEO_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext);
};

export const getMediaType = (path: string, filename: string): MediaType => {
  const lowerPath = path.toLowerCase();
  const ext = filename.split('.').pop()?.toLowerCase();

  if (ext && AUDIO_EXTENSIONS.has(ext)) return 'Music';
  
  // Heuristics for TV Shows vs Movies
  if (/[sS]\d{1,2}[eE]\d{1,2}/.test(filename)) return 'TV Show'; // S01E01 pattern
  if (lowerPath.includes('season')) return 'TV Show';
  if (lowerPath.includes('tv shows') || lowerPath.includes('series')) return 'TV Show';
  
  if (lowerPath.includes('movies') || lowerPath.includes('film')) return 'Movie';
  
  // Default to Movie for video files if ambiguous, or Unknown
  if (ext && VIDEO_EXTENSIONS.has(ext)) return 'Movie';

  return 'Unknown';
};

export const parseQuality = (filename: string): string | null => {
  const lower = filename.toLowerCase();
  if (lower.includes('3d') || lower.includes('.sbs.') || lower.includes('.hou.')) return '3D';
  if (lower.includes('2160p') || lower.includes('4k')) return '4K';
  if (lower.includes('1080p')) return '1080p';
  if (lower.includes('720p')) return '720p';
  if (lower.includes('480p')) return '480p';
  if (lower.includes('576p')) return '576p';
  if (lower.includes('bluray') || lower.includes('remux')) return 'High (BluRay)';
  if (lower.includes('dvd') || lower.includes('dvdrip')) return 'SD (DVD)';
  return null;
};

export const parseLibraryName = (pathSegments: string[]): string => {
  // Usually the top-level folder is the library name (e.g., "Movies", "Action")
  if (pathSegments.length > 0) return pathSegments[0];
  return 'Root';
};

export const formatBytes = (bytes: number, decimals = 2) => {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

export const cleanName = (filename: string): string => {
  // Remove extension
  let name = filename.replace(/\.[^/.]+$/, "");
  // Remove common scene tags roughly
  name = name.replace(/\./g, " ");
  name = name.replace(/\(.*\)/g, ""); // Remove years/info in parens for cleaner list name
  name = name.replace(/\[.*\]/g, "");
  // Remove quality tags if present in name
  name = name.replace(/\b(3d|2160p|1080p|720p|480p|4k|bluray|x264|x265|hevc|aac|dts)\b/gi, "");
  return name.trim();
};

/**
 * Extracts Series Name from filename (e.g. "Stranger.Things.S01E01..." -> "Stranger Things")
 */
export const getSeriesName = (filename: string): string | null => {
  // Regex for S01E01 or 1x01
  // Capture group 1 is the name before the season pattern
  const regex = /(.*?)(?:[\s\.](?:s\d{1,2}e\d{1,2}|\d{1,2}x\d{1,2}))/i;
  const match = filename.match(regex);
  if (match) {
    return cleanName(match[1]);
  }
  return null;
};

/**
 * Extracts Season and Episode numbers from filename
 */
export const parseEpisodeInfo = (filename: string): { season: number, episode: number, full: string } | null => {
    // S01E01 or 1x01
    const regex = /(?:[sS](\d{1,2})[eE](\d{1,2})|(\d{1,2})x(\d{1,2}))/;
    const match = filename.match(regex);
    if (match) {
        // match[1] is season (S01), match[2] is episode (E01)
        // match[3] is season (1x), match[4] is episode (x01)
        const season = match[1] || match[3];
        const episode = match[2] || match[4];
        return {
            season: parseInt(season, 10),
            episode: parseInt(episode, 10),
            full: match[0].toUpperCase() // S01E01
        };
    }
    return null;
};

/**
 * Extracts the Episode Title (text after SxxExx)
 */
export const getEpisodeTitle = (filename: string): string => {
   // Look for SxxExx pattern, then take the rest
   const regex = /(?:s\d{1,2}e\d{1,2}|\d{1,2}x\d{1,2})[\.\s-](.*)/i;
   const match = filename.match(regex);
   if (match) {
       // match[1] includes the rest of the filename (including quality tags etc)
       // We use cleanName to strip those tags
       return cleanName(match[1]);
   }
   return "";
};

export const fuzzyMatch = (text: string, query: string): boolean => {
  if (!query) return true;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  
  if (t.includes(q)) return true;

  const words = q.split(/\s+/);
  return words.every(w => t.includes(w));
};
