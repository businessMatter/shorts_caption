# Shorts Captions (Static) — Spec

Pure client-side web app deployed on GitHub Pages. All processing runs in the browser — no server, no backend, no data leaves the user's machine.

Live at: https://businessmatter.github.io/shorts_caption/

---

## Features

### 1. Estimate Timing

Upload a `.txt` caption script (blank lines separate blocks). Each block becomes one SRT subtitle entry with duration estimated from character count.

**Parameters:**

| Name       | Default | Description                    |
|------------|---------|--------------------------------|
| `cps`      | 5.0     | Characters per second          |
| `start_at` | 3.0     | First caption start time (sec) |
| `min_dur`  | 1.2     | Minimum duration (sec)         |
| `max_dur`  | 7.0     | Maximum duration (sec)         |

**Output:** browser-downloaded `{stem}.srt` (UTF-8 BOM, CRLF, Premiere-compatible).

### 2. Resync

Upload a `.txt` (new text) + `.srt` (hand-timed reference). Maps new text blocks onto the existing SRT's timecodes entry-by-entry. Block count must match or shows error.

**Output:** browser-downloaded `{stem} synced.srt`.

### 3. History

Every generate/resync result is saved to `localStorage`. The history view lists all entries newest-first with re-download and batch-delete.

**Storage:** browser-local only — per-device, per-browser, cleared if the user clears site data. Not shared between users or devices.

---

## Architecture

### Single-page app

One `index.html` with two views toggled by JavaScript (no page reloads, no routing library):

- **Shorts view** (`#`) — estimate + resync forms
- **History view** (`#history`) — saved results table

### File layout

```
shorts_caption/
├── index.html          # Single page with both views
├── style.css           # Design system (light/dark theme)
├── site.js             # SRT engine + UI logic
└── fonts/              # Self-hosted web fonts
    ├── Inter-{300,400,500,600}.woff2
    ├── DMSerifDisplay-400.woff2
    ├── JetBrainsMono-{300,400,500,600}.woff2
    └── OFL-LICENSES.txt
```

13 files total. No build step, no bundler, no dependencies.

---

## SRT Engine (JavaScript)

Originally ported from `shorts_captions.py`; the static version now removes generated placeholders and safely handles legacy guards. Functions:

| Function | Description |
|----------|-------------|
| `parseBlocks(text)` | Split text by blank lines into blocks (list of line arrays) |
| `parseSrt(text)` | Extract `{idx, start, end}` entries from SRT string |
| `estimateTiming(blocks, cps, startAt, minDur, maxDur)` | Generate SRT string with estimated timecodes |
| `resync(blocks, srtEntries, mode)` | Map text blocks onto existing SRT timecodes |
| `formatForPremiere(srtText)` | Add UTF-8 BOM + CRLF line endings |
| `decodeFile(arrayBuffer)` | Decode uploaded bytes (UTF-8-sig → UTF-8 → GB18030 fallback) |
| `tcToMs(tc)` / `msToTc(ms)` | Timecode ↔ milliseconds conversion |

### SRT output rules (Premiere compatibility)

1. UTF-8 BOM prefix (U+FEFF)
2. CRLF line endings
3. No trailing blank line after last entry
4. Generate adds no placeholder entries, including when starting at zero.
5. Resync preserves every real caption start/end time. It strips only blank 40ms boundary entries from legacy files; real 40ms captions are preserved.

---

## File Handling

| Step | How |
|------|-----|
| **Upload** | `<input type="file">` → `FileReader.readAsArrayBuffer()` — file stays in browser memory |
| **Decode** | `TextDecoder` with UTF-8 / GB18030 fallback |
| **Process** | JS functions in-memory — no network calls |
| **Download** | `Blob` → `URL.createObjectURL()` → programmatic `<a>` click |

No file ever leaves the user's machine.

---

## History (localStorage)

**Key:** `shortsCaptionsHistory`

**Entry schema:**
```json
{
  "id": "mu22ohjxfckm",
  "name": "bird flu",
  "feature": "estimate",
  "srtFilename": "bird flu.srt",
  "srtContent": "1\n00:00:03,000 --> ...",
  "createdAt": "2026-09-15 02:48:34"
}
```

**Limitations:**
- Per-browser, per-device — not synced anywhere
- Cleared if user clears site data or uses private browsing
- ~5MB localStorage limit — sufficient for text-only SRT history

**Operations:** add (unshift to front), list (read + render), batch delete (filter by id set), re-download (reconstruct Blob from stored `srtContent`).

---

## Error Handling

| Condition                      | Behavior                                                   |
|--------------------------------|------------------------------------------------------------|
| Missing `.txt`                 | Submit button stays disabled                               |
| Missing `.srt` (resync)       | Submit button stays disabled                               |
| Wrong file extension           | Upload zone shows "Wrong file type" warning                |
| Empty/unparseable text         | Error box: "No text blocks found in uploaded file"         |
| Empty/unparseable SRT          | Error box: "No valid entries found in uploaded SRT file"    |
| Block count ≠ SRT count       | Error box: "Block count mismatch: .txt has X, .srt has Y…" |

All errors render inline in an error box above the forms — no alerts, no page navigation.

---

## UI Components

- **Theme toggle** — light/dark, persisted to `localStorage` key `shortsCaptionsTheme`, respects `prefers-color-scheme` as default
- **Upload zones** — click or drag-and-drop, file extension validation, remove button, filename display
- **Toast** — "SRT downloaded · view in History" after successful generate, with clickable link to switch view
- **History table** — select-all checkbox, per-row checkbox, batch delete with confirm dialog, per-row download button

---

## Deployment

Hosted on GitHub Pages from the `gh-pages` branch. No build step — GitHub serves the files as-is.

| Setting | Value |
|---------|-------|
| Repo | `businessMatter/shorts_caption` |
| Branch | `gh-pages` |
| Path | `/` (root) |
| URL | `https://businessmatter.github.io/shorts_caption/` |

---

## Relationship to Flask Version

The `master` branch holds a Flask + Python backend version of the same app (for local use with `python run_webapp.py`). Both branches share:

- Shared original SRT processing design (the static version now differs in guard handling)
- Identical design system (CSS tokens, fonts, component patterns)
- Identical UI layout and behavior

Differences:

| | `master` (Flask) | `gh-pages` (Static) |
|-|-------------------|---------------------|
| Runtime | Python + waitress server | Browser only |
| History storage | Filesystem (one folder per entry) | localStorage |
| Config | `config/webapp.yaml` | None needed |
| Dependencies | flask, waitress, pyyaml | None |
| Branding label | "v0.1.0 · local" | "v0.1.0 · static" |

## PR2022 Resync (v0.2.2)

The additional button selects `pr2022` mode for the user-validated Windows Premiere 22.6.4 Build 2 / 25fps workaround. It appends one blank space caption lasting 40ms, starting at the final real caption end. All real timecodes remain unchanged. Premiere may display this placeholder at the beginning. Normal Resync and Generate add no guard.

Both modes remove legacy empty 40ms boundary guards before matching text counts; real one-frame captions are retained. Repeated PR2022 resync does not accumulate guards or extend real caption timing. PR2022 downloads use ` synced PR2022.srt` and history shows `PR2022 resync`.
