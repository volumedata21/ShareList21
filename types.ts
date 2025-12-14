export type MediaType = 'Movie' | 'TV Show' | 'Music' | 'Unknown';

// Represents a specific physical file on disk
export interface MediaFile {
  id: string;
  rawFilename: string;
  path: string;           // Full relative path
  library: string;        // Inferred library
  quality: string | null; // e.g. "4K"
  owner: string;          // User/Owner name
  handle?: FileSystemFileHandle; // Optional: Browser only
  // Stats loaded asynchronously or provided by server
  sizeBytes?: number;
  lastModified?: number;
}

// Represents the logical content (grouped by name)
export interface MediaItem {
  id: string;
  name: string;      // Cleaned Name (e.g. "Avatar")
  type: MediaType;
  files: MediaFile[]; // List of available versions/files
}

export type FilterType = 'All' | MediaType;