export type MediaType = 'Movie' | 'TV Show' | 'Music' | 'Unknown';

export interface MediaFile {
  id?: string;
  rawFilename: string;
  path: string;
  library: string;
  quality: string | null;
  owner: string;
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
  hostUser?: string; // NEW: Tells the frontend who owns this server
}