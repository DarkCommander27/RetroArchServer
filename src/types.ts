export type ThumbnailKind = "Named_Boxarts" | "Named_Snaps" | "Named_Titles" | "Named_Logos";

export interface RetroArchPlaylistItem {
  path: string;
  label: string;
  core_path: string;
  core_name: string;
  crc32: string;
  db_name: string;
}

export interface RetroArchPlaylist {
  version: string;
  items: RetroArchPlaylistItem[];
}

export interface RetroArchEntryInput {
  path: string;
  label: string;
  core_path?: string;
  core_name?: string;
  crc32?: string;
  db_name?: string;
}

export interface LibraryEntry {
  id: string;
  label: string;
  romPath: string;
  relativeRomPath: string;
  playlistName: string;
  dbName: string;
  corePath: string;
  coreName: string;
  crc32: string;
  thumbnailUrls: Partial<Record<ThumbnailKind, string>>;
}

export interface LibraryPlaylist {
  name: string;
  fileName: string;
  filePath: string;
  version: string;
  entries: LibraryEntry[];
}

export interface LibrarySummary {
  retroarchRoot: string;
  playlistsRoot: string;
  thumbnailsRoot: string;
  romsRoot: string | null;
  playlistCount: number;
  gameCount: number;
  playlists: LibraryPlaylist[];
}