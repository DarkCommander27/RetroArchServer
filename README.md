# RetroArch Server

Local server for a RetroArch library. It reads RetroArch JSON playlists, matches thumbnails using RetroArch naming rules, serves ROM downloads, returns launch commands you can feed back into RetroArch, and now includes browser-based playlist management plus official asset mirroring for offline use.

This project is RetroArch-specific, but it is intentionally focused on the content layout RetroArch actually consumes for local libraries:

- `playlists/*.lpl`
- `thumbnails/<Playlist Name>/Named_Boxarts|Named_Snaps|Named_Titles|Named_Logos`
- ROM paths referenced by each playlist entry

It does **not** try to mirror the public Libretro buildbot's full `stable/` and `nightly/` updater tree, because that structure is for distributing cores and updater assets, not for serving a personal ROM collection.

## What it does

- Parses RetroArch `.lpl` JSON playlists
- Creates playlists and edits entries from the browser
- Imports `.lpl` files and ROM uploads directly into your local library
- Resolves relative ROM paths against your RetroArch root or an explicit ROM root
- Matches thumbnails the same way RetroArch does: filename, label, then shortened label
- Mirrors official RetroArch frontend asset bundles from the Libretro buildbot into your local RetroArch root
- Mirrors official playlist thumbnails from `thumbnails.libretro.com` into your local thumbnails directory
- Serves a small web UI for browsing playlists and games
- Exposes JSON endpoints for library data, thumbnails, ROM downloads, and launch commands

## Offline asset workflow

If you want a machine to stay usable without internet while keeping the same upstream asset version locally:

1. Sync frontend asset packs from the browser UI or `POST /api/sync/frontend-assets`
2. Sync playlist thumbnails from the browser UI or `POST /api/sync/thumbnails`
3. Keep the resulting `RETROARCH_ROOT` folder on that machine or copy it to other systems

Frontend asset sync pulls directly from the official buildbot asset zips such as `assets.zip`, `database-rdb.zip`, `info.zip`, `overlays.zip`, and shader packs.

Thumbnail sync pulls directly from the official RetroArch thumbnail server by playlist name.

## Project layout

By default the server expects a local RetroArch-style library root at `./library`:

```text
library/
	playlists/
		Nintendo - Game Boy.lpl
	thumbnails/
		Nintendo - Game Boy/
			Named_Boxarts/
			Named_Snaps/
			Named_Titles/
			Named_Logos/
	roms/
		Nintendo - Game Boy/
			Tetris.gb
```

You can also point it at your real RetroArch folders with environment variables.

## Playlist format

This server is built for the current RetroArch JSON playlist format, for example:

```json
{
	"version": "1.5",
	"items": [
		{
			"path": "roms/Nintendo - Game Boy/Tetris.gb",
			"label": "Tetris (World)",
			"core_path": "DETECT",
			"core_name": "DETECT",
			"crc32": "DETECT",
			"db_name": "Nintendo - Game Boy.lpl"
		}
	]
}
```

## Setup

```bash
npm install
npm run dev
```

Or build and run the compiled server:

```bash
npm run build
npm start
```

The app listens on `http://localhost:3000` by default.

## Configuration

Copy `.env.example` into `.env` if you want a fixed local config.

Supported variables:

- `PORT`: server port
- `HOST`: bind address
- `RETROARCH_ROOT`: base folder containing `playlists/`, `thumbnails/`, and optionally `roms/`
- `ROMS_ROOT`: optional override when playlist paths should resolve against a separate ROM folder
- `PLAYLISTS_ROOT`: optional override for a non-standard playlists directory
- `THUMBNAILS_ROOT`: optional override for a non-standard thumbnails directory
- `FRONTEND_ASSETS_BASE_URL`: override the official Libretro frontend asset source
- `THUMBNAILS_BASE_URL`: override the official RetroArch thumbnail source

Example using an existing RetroArch install on Linux:

```bash
RETROARCH_ROOT="$HOME/.config/retroarch" npm run dev
```

Example using separate ROM storage:

```bash
RETROARCH_ROOT="$HOME/.config/retroarch" ROMS_ROOT="/mnt/games/roms" npm run dev
```

## API

- `GET /api/library`: full playlist and game summary
- `GET /api/options`: frontend pack list, thumbnail kinds, and current playlist names for the UI
- `POST /api/playlists`: create a playlist file
- `POST /api/playlists/:playlistName/entries`: add a playlist entry
- `PUT /api/playlists/:playlistName/entries/:entryId`: edit a playlist entry
- `DELETE /api/playlists/:playlistName/entries/:entryId`: remove a playlist entry
- `POST /api/import/playlist`: upload an existing `.lpl` file
- `POST /api/import/rom`: upload a ROM file and add it to a playlist
- `POST /api/sync/frontend-assets`: download and extract official frontend asset packs into `RETROARCH_ROOT`
- `POST /api/sync/thumbnails`: mirror official thumbnails for one playlist or all local playlists
- `GET /api/roms/:entryId`: download a ROM file referenced by a playlist entry
- `GET /api/launch/:entryId`: get a RetroArch CLI command for launching that entry
- `GET /api/thumbnails/:playlist/:kind/:fileName`: serve a matching thumbnail image

## Notes on RetroArch behavior

- Relative playlist paths are resolved against `ROMS_ROOT` when set, otherwise against `RETROARCH_ROOT`
- Thumbnail matching follows RetroArch-style filename sanitizing for invalid characters like `*` and `:`
- If a playlist entry has `core_path = "DETECT"`, the launch command leaves core selection to RetroArch
- Frontend asset sync extracts official buildbot zip contents straight into `RETROARCH_ROOT`
- Thumbnail sync uses playlist names as they appear in RetroArch, so custom playlist names should match the upstream thumbnail folder if you want official artwork downloads

## Validation

Current validation run for this repo:

- `npm run build`
- `npm start`
- `curl http://127.0.0.1:3000/api/library`
- `curl http://127.0.0.1:3000/api/options`
- `curl -X POST http://127.0.0.1:3000/api/playlists -d '{"name":"2048"}'`
- `curl -X POST http://127.0.0.1:3000/api/import/rom ...`
- `curl -X POST http://127.0.0.1:3000/api/sync/frontend-assets -d '{"packs":["database-cursors.zip"]}'`
- `curl -X POST http://127.0.0.1:3000/api/sync/thumbnails -d '{"playlistNames":["2048"],"kinds":["Named_Boxarts"]}'`
