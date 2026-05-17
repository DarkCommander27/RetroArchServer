import path from "node:path";

export interface AppConfig {
  port: number;
  host: string;
  retroarchRoot: string;
  playlistsRoot: string;
  thumbnailsRoot: string;
  romsRoot: string | null;
  staticRoot: string;
  frontendAssetsBaseUrl: string;
  thumbnailsBaseUrl: string;
}

function resolvePath(value: string | undefined, fallback: string): string {
  return path.resolve(value ?? fallback);
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }

  return fallback;
}

export function loadConfig(): AppConfig {
  const retroarchRoot = resolvePath(process.env.RETROARCH_ROOT, path.join(process.cwd(), "library"));
  const romsRoot = process.env.ROMS_ROOT ? path.resolve(process.env.ROMS_ROOT) : null;

  return {
    port: parsePort(process.env.PORT, 3000),
    host: process.env.HOST || "0.0.0.0",
    retroarchRoot,
    playlistsRoot: resolvePath(process.env.PLAYLISTS_ROOT, path.join(retroarchRoot, "playlists")),
    thumbnailsRoot: resolvePath(process.env.THUMBNAILS_ROOT, path.join(retroarchRoot, "thumbnails")),
    romsRoot,
    staticRoot: path.resolve(process.cwd(), "public"),
    frontendAssetsBaseUrl: process.env.FRONTEND_ASSETS_BASE_URL || "https://buildbot.libretro.com/assets/frontend",
    thumbnailsBaseUrl: process.env.THUMBNAILS_BASE_URL || "https://thumbnails.libretro.com"
  };
}