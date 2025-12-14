export type MediaType = 'Movie' | 'TV Show' | 'Music' | 'Unknown';

export interface MediaFile {
  id?: string;
  rawFilename: string;
  path: string;           // Relative path e.g. "Movies/Avatar.mkv"
  library: string;        // e.g. "Movies"
  quality: string | null; // e.g. "4K"
  owner: string;          // e.g. "Lamaar"
  sizeBytes: number;
  lastModified: number;
}

export interface SyncPayload {
  owner: string;
  files: MediaFile[];
}

export interface AppConfig {
  users: string[];
  requiresPin: boolean;
}