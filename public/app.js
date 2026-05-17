const playlistsElement = document.querySelector("#playlists");
const searchElement = document.querySelector("#search");
const summaryElement = document.querySelector("#summary");
const statusElement = document.querySelector("#status");
const playlistTemplate = document.querySelector("#playlist-template");
const entryTemplate = document.querySelector("#entry-template");
const createPlaylistForm = document.querySelector("#create-playlist-form");
const importPlaylistForm = document.querySelector("#import-playlist-form");
const uploadRomForm = document.querySelector("#upload-rom-form");
const uploadRomPlaylistSelect = document.querySelector("#upload-rom-playlist");
const syncFrontendForm = document.querySelector("#sync-frontend-form");
const syncThumbnailsForm = document.querySelector("#sync-thumbnails-form");
const frontendPackList = document.querySelector("#frontend-pack-list");
const thumbnailKindList = document.querySelector("#thumbnail-kind-list");
const thumbnailPlaylistSelect = document.querySelector("#thumbnail-playlist-select");

const state = {
  library: null,
  options: null
};

function showStatus(message, tone = "info") {
  if (!message) {
    statusElement.hidden = true;
    statusElement.textContent = "";
    statusElement.dataset.tone = "";
    return;
  }

  statusElement.hidden = false;
  statusElement.textContent = message;
  statusElement.dataset.tone = tone;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    throw new Error(payload?.error || response.statusText || "Request failed.");
  }

  return payload;
}

function encodeSegment(value) {
  return encodeURIComponent(value);
}

function populateSelect(select, options, includeAll = false) {
  select.innerHTML = "";

  if (includeAll) {
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "All local playlists";
    select.appendChild(allOption);
  }

  for (const optionValue of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionValue;
    select.appendChild(option);
  }
}

function renderCheckboxes(container, values, name, checkedByDefault = true) {
  container.innerHTML = "";

  for (const value of values) {
    const label = document.createElement("label");
    label.className = "checkbox-pill";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = name;
    input.value = value;
    input.checked = checkedByDefault;

    const span = document.createElement("span");
    span.textContent = value;

    label.append(input, span);
    container.appendChild(label);
  }
}

function getCheckedValues(container, selector) {
  return Array.from(container.querySelectorAll(selector))
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function buildDefaultEntryPath(playlistName, label = "new-game") {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "new-game";
  return `roms/${playlistName}/${safeLabel}.zip`;
}

function promptForEntry(playlistName, entry = null) {
  const pathValue = window.prompt(
    "RetroArch playlist path",
    entry?.relativeRomPath || buildDefaultEntryPath(playlistName, entry?.label)
  );

  if (pathValue === null) {
    return null;
  }

  const label = window.prompt("Display label", entry?.label || "");

  if (label === null || !label.trim()) {
    return null;
  }

  const corePath = window.prompt("Core path", entry?.corePath || "DETECT");

  if (corePath === null) {
    return null;
  }

  const coreName = window.prompt("Core name", entry?.coreName || "DETECT");

  if (coreName === null) {
    return null;
  }

  const crc32 = window.prompt("CRC32", entry?.crc32 || "DETECT");

  if (crc32 === null) {
    return null;
  }

  const dbName = window.prompt("DB name", entry?.dbName || `${playlistName}.lpl`);

  if (dbName === null) {
    return null;
  }

  return {
    path: pathValue.trim(),
    label: label.trim(),
    corePath: corePath.trim() || "DETECT",
    coreName: coreName.trim() || "DETECT",
    crc32: crc32.trim() || "DETECT",
    dbName: dbName.trim() || `${playlistName}.lpl`
  };
}

async function refreshData() {
  const [library, options] = await Promise.all([
    requestJson("/api/library"),
    requestJson("/api/options")
  ]);

  state.library = library;
  state.options = options;

  renderSummary();
  renderControls();
  renderPlaylists();
}

function renderSummary() {
  const library = state.library;

  summaryElement.innerHTML = `
    <div class="summary-card">
      <strong>${library.playlistCount}</strong>
      <span>playlists</span>
    </div>
    <div class="summary-card">
      <strong>${library.gameCount}</strong>
      <span>games</span>
    </div>
    <div class="summary-card summary-paths">
      <strong>Playlists</strong>
      <span>${library.playlistsRoot}</span>
    </div>
    <div class="summary-card summary-paths">
      <strong>RetroArch root</strong>
      <span>${library.retroarchRoot}</span>
    </div>
  `;
}

function renderControls() {
  populateSelect(uploadRomPlaylistSelect, state.options.playlists);
  populateSelect(thumbnailPlaylistSelect, state.options.playlists, true);
  renderCheckboxes(frontendPackList, state.options.frontendAssetPacks, "frontend-pack");
  renderCheckboxes(thumbnailKindList, state.options.thumbnailKinds.filter((kind) => kind !== "Named_Logos"), "thumbnail-kind");
}

function createEntry(entry, playlist) {
  const fragment = entryTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".entry-card");
  const title = fragment.querySelector("h3");
  const core = fragment.querySelector(".core");
  const pathText = fragment.querySelector(".path");
  const downloadLink = fragment.querySelector(".download-link");
  const launchButton = fragment.querySelector(".launch-button");
  const editButton = fragment.querySelector(".edit-entry-button");
  const removeButton = fragment.querySelector(".remove-entry-button");
  const launchCommand = fragment.querySelector(".launch-command");
  const cover = fragment.querySelector(".cover");

  title.textContent = entry.label;
  core.textContent = entry.coreName === "DETECT" ? "Core: detect in RetroArch" : `Core: ${entry.coreName}`;
  pathText.textContent = entry.relativeRomPath;
  downloadLink.href = `/api/roms/${entry.id}`;

  const coverSource = entry.thumbnailUrls.Named_Boxarts || entry.thumbnailUrls.Named_Titles || entry.thumbnailUrls.Named_Snaps;

  if (coverSource) {
    cover.src = coverSource;
    cover.alt = `${entry.label} artwork`;
  } else {
    cover.removeAttribute("src");
    cover.alt = "No artwork available";
    cover.classList.add("cover-empty");
  }

  launchButton.addEventListener("click", async () => {
    try {
      if (!launchCommand.hidden) {
        launchCommand.hidden = true;
        return;
      }

      const data = await requestJson(`/api/launch/${entry.id}`);
      launchCommand.textContent = data.command;
      launchCommand.hidden = false;
    } catch (error) {
      showStatus(error.message, "error");
    }
  });

  editButton.addEventListener("click", async () => {
    const payload = promptForEntry(playlist.name, entry);

    if (!payload) {
      return;
    }

    try {
      showStatus(`Saving ${entry.label}...`);
      await requestJson(`/api/playlists/${encodeSegment(playlist.name)}/entries/${entry.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      await refreshData();
      showStatus(`Updated ${payload.label}.`, "success");
    } catch (error) {
      showStatus(error.message, "error");
    }
  });

  removeButton.addEventListener("click", async () => {
    const confirmed = window.confirm(`Remove ${entry.label} from ${playlist.name}?`);

    if (!confirmed) {
      return;
    }

    try {
      showStatus(`Removing ${entry.label}...`);
      await fetch(`/api/playlists/${encodeSegment(playlist.name)}/entries/${entry.id}`, {
        method: "DELETE"
      }).then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || response.statusText || "Delete failed.");
        }
      });
      await refreshData();
      showStatus(`Removed ${entry.label}.`, "success");
    } catch (error) {
      showStatus(error.message, "error");
    }
  });

  card.dataset.search = `${entry.label} ${entry.relativeRomPath} ${entry.coreName}`.toLowerCase();

  return fragment;
}

function createPlaylist(playlist) {
  const fragment = playlistTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".playlist-card");
  const title = fragment.querySelector("h2");
  const meta = fragment.querySelector(".meta");
  const entriesElement = fragment.querySelector(".entries");
  const addEntryButton = fragment.querySelector(".playlist-add-entry");
  const syncThumbnailsButton = fragment.querySelector(".playlist-sync-thumbnails");

  title.textContent = playlist.name;
  meta.textContent = `${playlist.entries.length} game${playlist.entries.length === 1 ? "" : "s"}`;
  card.dataset.search = `${playlist.name}`.toLowerCase();

  addEntryButton.addEventListener("click", async () => {
    const payload = promptForEntry(playlist.name);

    if (!payload) {
      return;
    }

    try {
      showStatus(`Adding ${payload.label}...`);
      await requestJson(`/api/playlists/${encodeSegment(playlist.name)}/entries`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      await refreshData();
      showStatus(`Added ${payload.label}.`, "success");
    } catch (error) {
      showStatus(error.message, "error");
    }
  });

  syncThumbnailsButton.addEventListener("click", async () => {
    try {
      showStatus(`Syncing official thumbnails for ${playlist.name}...`);
      const result = await requestJson("/api/sync/thumbnails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          playlistNames: [playlist.name],
          kinds: ["Named_Boxarts", "Named_Snaps", "Named_Titles"]
        })
      });
      await refreshData();
      const totalDownloaded = result.result.reduce((count, item) => count + item.downloaded, 0);
      showStatus(`Synced ${totalDownloaded} thumbnail files for ${playlist.name}.`, "success");
    } catch (error) {
      showStatus(error.message, "error");
    }
  });

  for (const entry of playlist.entries) {
    entriesElement.appendChild(createEntry(entry, playlist));
  }

  return fragment;
}

function renderPlaylists() {
  playlistsElement.innerHTML = "";

  for (const playlist of state.library.playlists) {
    playlistsElement.appendChild(createPlaylist(playlist));
  }

  applyFilter();
}

function applyFilter() {
  const query = searchElement.value.trim().toLowerCase();
  const playlistCards = Array.from(document.querySelectorAll(".playlist-card"));

  for (const playlistCard of playlistCards) {
    const entryCards = Array.from(playlistCard.querySelectorAll(".entry-card"));
    let visibleEntries = 0;

    for (const entryCard of entryCards) {
      const matches = !query || entryCard.dataset.search.includes(query) || playlistCard.dataset.search.includes(query);
      entryCard.hidden = !matches;

      if (matches) {
        visibleEntries += 1;
      }
    }

    playlistCard.hidden = visibleEntries === 0 && query.length > 0;
  }
}

createPlaylistForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const form = new FormData(createPlaylistForm);
  const name = String(form.get("name") || "").trim();

  if (!name) {
    showStatus("Playlist name is required.", "error");
    return;
  }

  try {
    showStatus(`Creating ${name}...`);
    await requestJson("/api/playlists", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ name })
    });
    createPlaylistForm.reset();
    await refreshData();
    showStatus(`Created ${name}.`, "success");
  } catch (error) {
    showStatus(error.message, "error");
  }
});

importPlaylistForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    showStatus("Uploading playlist...");
    const form = new FormData(importPlaylistForm);
    await requestJson("/api/import/playlist", {
      method: "POST",
      body: form
    });
    importPlaylistForm.reset();
    await refreshData();
    showStatus("Playlist imported.", "success");
  } catch (error) {
    showStatus(error.message, "error");
  }
});

uploadRomForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    showStatus("Importing ROM...");
    const form = new FormData(uploadRomForm);
    await requestJson("/api/import/rom", {
      method: "POST",
      body: form
    });
    uploadRomForm.reset();
    await refreshData();
    showStatus("ROM imported and playlist updated.", "success");
  } catch (error) {
    showStatus(error.message, "error");
  }
});

syncFrontendForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const packs = getCheckedValues(frontendPackList, 'input[type="checkbox"]');
    showStatus(`Syncing ${packs.length || state.options.frontendAssetPacks.length} official frontend packs...`);
    const result = await requestJson("/api/sync/frontend-assets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ packs })
    });
    const extracted = result.result.reduce((count, item) => count + item.extractedFiles, 0);
    showStatus(`Frontend sync complete. Extracted ${extracted} files.`, "success");
  } catch (error) {
    showStatus(error.message, "error");
  }
});

syncThumbnailsForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const playlistName = thumbnailPlaylistSelect.value;
    const kinds = getCheckedValues(thumbnailKindList, 'input[type="checkbox"]');
    const targetLabel = playlistName || "all local playlists";
    showStatus(`Syncing official thumbnails for ${targetLabel}...`);
    const result = await requestJson("/api/sync/thumbnails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        playlistNames: playlistName ? [playlistName] : [],
        kinds
      })
    });
    await refreshData();
    const downloaded = result.result.reduce((count, item) => count + item.downloaded, 0);
    showStatus(`Thumbnail sync complete. Downloaded ${downloaded} files for ${targetLabel}.`, "success");
  } catch (error) {
    showStatus(error.message, "error");
  }
});

searchElement.addEventListener("input", applyFilter);

refreshData().catch((error) => {
  showStatus(error.message, "error");
});