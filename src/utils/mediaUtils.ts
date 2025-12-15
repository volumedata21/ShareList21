export const formatBytes = (bytes: number, decimals = 2): string => {
  if (!bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

export const getMediaType = (path: string, filename: string): 'Movie' | 'TV Show' | 'Music' | 'Unknown' => {
  const lowerPath = path.toLowerCase();
  const lowerName = filename.toLowerCase();
  
  // 1. Explicit Folder Check (Safest)
  // If the file is in a folder named 'Music', 'Artist', etc.
  if (lowerPath.includes('/music/') || lowerPath.startsWith('music/')) return 'Music';
  if (lowerPath.includes('/tv/') || lowerPath.includes('/shows/') || lowerPath.startsWith('tv/')) return 'TV Show';
  if (lowerPath.includes('/movies/') || lowerPath.startsWith('movies/')) return 'Movie';

  // 2. Extension Check
  if (/\.(mp3|flac|wav|m4a|aac|ogg|wma|alac|aiff|ape|opus)$/.test(lowerName)) return 'Music';
  
  // 3. Video Disambiguation (TV vs Movie)
  if (/\.(mkv|mp4|avi|mov|wmv|m4v|ts|iso)$/.test(lowerName)) {
     // S01E01 pattern or "Season" folder implies TV
     if (/s\d{2}e\d{2}/.test(lowerName) || lowerPath.includes('season')) return 'TV Show';
     return 'Movie';
  }
  
  return 'Unknown';
};

export const cleanName = (filename: string): string => {
  let name = filename;

  // 1. Remove Extension
  name = name.replace(/\.[^/.]+$/, "");

  // 2. Replace dots/underscores with spaces
  name = name.replace(/[._]/g, " ");

  // 3. Remove common release tags (case insensitive)
  const tagsToRemove = [
    '4k', '2160p', '1080p', '720p', '480p', 'sd',
    'bluray', 'web-dl', 'webrip', 'dvdrip', 'hdr', 'dv',
    'x264', 'x265', 'hevc', 'aac', 'ac3', 'dts', 'atmos',
    'remastered', 'extended', 'cut'
  ];
  
  const tagRegex = new RegExp(`\\b(${tagsToRemove.join('|')})\\b`, 'gi');
  name = name.replace(tagRegex, '');

  // 4. Fix "Name (Year) - " Pattern (The one you asked for)
  // "RoboCop (1987) - " -> "RoboCop (1987)"
  // Matches Year followed by hyphen at the end of the string
  name = name.replace(/(\(\d{4}\))\s*-\s*$/, '$1');
  
  // 5. General Cleanup
  name = name.replace(/\s*-\s*$/, ''); // Remove trailing " -"
  name = name.replace(/\s{2,}/g, ' '); // Collapse double spaces

  return name.trim();
};

export const fuzzyMatch = (text: string, query: string): boolean => {
  return text.toLowerCase().includes(query.toLowerCase());
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