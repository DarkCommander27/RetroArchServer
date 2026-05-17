import fs from "node:fs/promises";
import path from "node:path";
import unzipper from "unzipper";
import type { ThumbnailKind } from "./types";

export const FRONTEND_ASSET_PACKS = [
  "assets.zip",
  "autoconfig.zip",
  "cheats.zip",
  "database-cursors.zip",
  "database-rdb.zip",
  "info.zip",
  "overlays.zip",
  "shaders_cg.zip",
  "shaders_glsl.zip",
  "shaders_slang.zip"
] as const;

type FrontendAssetPack = (typeof FRONTEND_ASSET_PACKS)[number];

interface FrontendSyncOptions {
  baseUrl: string;
  destinationRoot: string;
  packs: string[];
}

interface ThumbnailSyncOptions {
  baseUrl: string;
  destinationRoot: string;
  playlistNames: string[];
  kinds: ThumbnailKind[];
}

function ensureSafeDestination(rootPath: string, targetPath: string): string {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);

  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Refusing to write outside ${resolvedRoot}`);
  }

  return resolvedTarget;
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function extractZipBuffer(buffer: Buffer, destinationRoot: string): Promise<number> {
  const directory = await unzipper.Open.buffer(buffer);
  let extracted = 0;

  for (const entry of directory.files) {
    const destinationPath = ensureSafeDestination(destinationRoot, path.join(destinationRoot, entry.path));

    if (entry.type === "Directory") {
      await fs.mkdir(destinationPath, { recursive: true });
      continue;
    }

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(destinationPath, await entry.buffer());
    extracted += 1;
  }

  return extracted;
}

function parseIndexLinks(html: string): string[] {
  const links = new Set<string>();
  const pattern = /href="([^"]+)"/g;

  for (const match of html.matchAll(pattern)) {
    const value = match[1];

    if (!value || value === "../" || value.startsWith("?") || value.startsWith("/")) {
      continue;
    }

    links.add(value);
  }

  return [...links];
}

async function listRemoteDirectory(url: string): Promise<string[]> {
  const response = await fetch(url);

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new Error(`Failed to list ${url}: ${response.status} ${response.statusText}`);
  }

  return parseIndexLinks(await response.text());
}

function buildRemoteUrl(baseUrl: string, ...segments: string[]): string {
  const encodedSegments = segments.map((segment) => encodeURIComponent(segment).replace(/%2F/g, "/"));
  return `${baseUrl.replace(/\/$/, "")}/${encodedSegments.join("/")}`;
}

export async function syncFrontendAssets(options: FrontendSyncOptions): Promise<Array<{ pack: string; extractedFiles: number }>> {
  const packs = options.packs.length > 0 ? options.packs : [...FRONTEND_ASSET_PACKS];
  const results: Array<{ pack: string; extractedFiles: number }> = [];

  for (const pack of packs) {
    if (!(FRONTEND_ASSET_PACKS as readonly string[]).includes(pack)) {
      throw new Error(`Unsupported frontend asset pack: ${pack}`);
    }

    const url = buildRemoteUrl(options.baseUrl, pack);
    const buffer = await fetchBuffer(url);
    const extractedFiles = await extractZipBuffer(buffer, options.destinationRoot);
    results.push({ pack, extractedFiles });
  }

  return results;
}

export async function syncPlaylistThumbnails(options: ThumbnailSyncOptions): Promise<Array<{ playlist: string; kind: ThumbnailKind; downloaded: number }>> {
  const results: Array<{ playlist: string; kind: ThumbnailKind; downloaded: number }> = [];

  for (const playlistName of options.playlistNames) {
    for (const kind of options.kinds) {
      const remoteDirectoryUrl = buildRemoteUrl(options.baseUrl, playlistName, kind) + "/";
      const files = (await listRemoteDirectory(remoteDirectoryUrl)).filter((value) => !value.endsWith("/"));
      const destinationDirectory = ensureSafeDestination(options.destinationRoot, path.join(options.destinationRoot, playlistName, kind));

      await fs.mkdir(destinationDirectory, { recursive: true });

      let downloaded = 0;

      for (const fileName of files) {
        const fileUrl = buildRemoteUrl(options.baseUrl, playlistName, kind, fileName);
        const contents = await fetchBuffer(fileUrl);
        const destinationPath = ensureSafeDestination(destinationDirectory, path.join(destinationDirectory, decodeURIComponent(fileName)));

        await fs.writeFile(destinationPath, contents);
        downloaded += 1;
      }

      results.push({ playlist: playlistName, kind, downloaded });
    }
  }

  return results;
}

export type { FrontendAssetPack };