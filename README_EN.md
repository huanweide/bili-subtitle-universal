**中文** · [README.md](./README.md)

<p align="center">
  <img src="assets/banner.svg" alt="bili-subtitle-universal — 全网视频字幕全能提取">
</p>

**English** · [README_EN.md](./README_EN.md)

# Universal Video Subtitle Extractor · AI Transcription Edition

> Not "yet another Bilibili subtitle script" — it's **the one that still gets you subtitles when there are none**.
> Official subtitles are grabbed instantly; when there are none, it uses AI transcription, and **even a 3-hour video runs to completion reliably**.

[![CI](https://github.com/huanweide/bili-subtitle-universal/actions/workflows/test.yml/badge.svg)](https://github.com/huanweide/bili-subtitle-universal/actions/workflows/test.yml)
[![version](https://img.shields.io/badge/version-9.17.1-FB7299)](https://github.com/huanweide/bili-subtitle-universal)
[![license](https://img.shields.io/badge/license-MIT-4ecca3)](LICENSE)
[![tests](https://img.shields.io/badge/tests-86%2F86-3a8ee6)](tests/run-tests.js)
[![userscript](https://img.shields.io/badge/Tampermonkey-Edge%20%7C%20Chrome%20%7C%20Firefox-7C5CBF)](https://www.tampermonkey.net/)

**Pipeline**: `open video page → 🎬 open panel → ⚡ get subtitles → (if none) 🎙 AI transcribe → 📋 copy / ⬇ SRT·VTT·MD`

[30-Second Overview](#30-second-overview) · [What It Does](#what-it-does) · [Features](#features) · [Quick Start](#quick-start) · [Architecture](#architecture) · [Security Boundary](#security-boundary) · [Roadmap](#roadmap) · [Contributing](#contributing)

---

## Who Should Use It / Who Should NOT

**Good fit if —**

- You want subtitles from **Bilibili, YouTube, or any webpage `<video>`** by clicking in the browser.
- Your video has **no subtitles** and you want AI transcription (e.g. a 3-hour lecture).
- You want a no-install, pure-frontend, privacy-preserving tool — keys and settings stay in the browser's local sandbox.

**Not for you if —**

- You want **batch / offline / scriptable** processing — use the Python version [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor) instead.
- You refuse to bring your own AI key for transcription. (Official subtitles need no key; AI transcription does.)
- You want a **video downloader** — it never downloads or transcodes video; it only handles subtitle text.

---

## 30-Second Overview

```text
BEFORE · a 3-hour lecture video with no subtitles
─────────────────────────────────────────────
  You       pause and type subtitles as you watch   →  all night
  Other scripts  "this video has no subtitles" then nothing   →  dead end
  This script    🎙 AI transcribe → segmented decode → resume →  after 3h you have a full transcript

AFTER · what actually happens in the panel
─────────────────────────────────────────────
$ open https://www.bilibili.com/video/BV…
  a "🎬 Subtitle" pill appears at bottom-right

$ click "⚡ Get Subtitles"
  ✔ hit official subtitles (Chinese · human) · 1,284 lines      ← no key, no cost, instant

$ if no subtitles → click "🎙 AI Transcribe"
  ① download  ② read duration  ③ segmented decode  ④ transcribe  ⑤ merge
  audio 86MB · duration 3:33:00 · processed 1:12:30 / 3:33:00 · used 2:14 · ETA 4:06
  [00:00:03] Hello, welcome to this episode
  [00:00:08] Last section we covered electron configuration
  [00:00:15] Now let's look at group 2A

$ export
  📋 copy · ⬇ TXT (with BOM) · ⬇ SRT · ⬇ VTT · ⬇ MD · 🤖 AI text · ⚓ anchor transcript
```

**The one-line difference**: other tools stop at "grab official subtitles"; this script turns the "no subtitles" dead end into a working path.

---

## What It Does

**Scenario 1 · Taking notes on a Bilibili course** (the uploader didn't upload subtitles)

```text
User: open the course page with a BV id
  → claim: /video/BV… matches Bilibili's rule table (modules/site-match.js)
  → get subtitles: WBI-signed official API → none
  → fallback: read DASH segment list → download + decode per segment → send to ASR every 2 min
  → write to disk: TXT / SRT, resumable
```

**Scenario 2 · Want a transcript of a YouTube video**

```text
User: open youtube.com/watch?v=…
  → claim: /watch?v= matches YouTube's rule table
  → parse subtitle tracks from the player response (both TTML timestamp forms fully supported)
  → auto subtitles flagged as AI; export SRT / VTT to load in the player
```

**Scenario 3 · A player embedded in someone's blog / any webpage `<video>`**

```text
User: open a page embedding player.bilibili.com/player.html
  → claim: iframe-embedded player (since v9.8) → read BV id from URL params
  → generic site: iterate all <video> on the page, scan <track kind="subtitles|captions">
  → parse WebVTT / SRT
```

---

## Features

- **SiteMatch engine** — site + page-shape recognition is centralized into one testable table instead of scattered regex; pages without a player are never claimed — claiming but failing to fetch hurts trust more than not claiming. See `modules/site-match.js`
- **Four-layer transcription fallback ladder** — segmented decode (preferred, no playback, constant memory) → whole-file upload (≤40MB) → decoded slices (16kHz) → silent playback recording (last resort); if one path is blocked, it automatically takes the next — no single path can kill it.
- **SegResume breakpoint gate** — every ~2-minute batch is written to disk as soon as it's transcribed; after refresh / accidental close / network drop, re-transcription automatically skips completed batches, **no paying twice**; breakpoints keyed by "BV id + P number + audio URL", valid 24h.
- **Vendor-agnostic layer (AI_PROVIDERS)** — transcription and translation vendors are switchable (SiliconFlow / OpenAI / DeepSeek / OpenRouter / custom OpenAI-compatible endpoint); key and model edited freely in settings; DeepSeek is explicitly marked as having no audio endpoint, avoiding a 404 when you click transcribe.
- **Three-layer quality (TranscriptQuality)** — layer 1 hotword injection (words from the video's own title/description/tags, **free**, auto-downgraded if the account doesn't support it) → layer 2 LLM correction (off by default, billed per call, rejects the whole batch if line count/order changes) → layer 3 punctuation restoration + sentence merge + adjacent-duplicate dedup (on by default).
- **Search-as-scope** — in-subtitle search with multi-word "AND" semantics; when N lines match, **copy / TXT / SRT / VTT / AI text / anchor transcript all output only the matched lines**; when nothing matches it falls back to the full text — better to give extra than an empty file.
- **Anchor immunity (RouteIdentity)** — `?t=120` / `spm_id_from` / `vd_source` never count toward "did the video change"; only a real video or P-number change resets; clicking a comment timestamp no longer clears subtitles.
- **Evidence-matrix gate (test-claims)** — every claim the README makes must point to a line of source code; **if it's written but not implemented, the test goes red**.
- **Pure-frontend boundary (default)** — no server; settings and API keys live only in Tampermonkey's local sandbox; there is no fetch to a self-owned service in the source (guarded by an assertion).

---

## Quick Start

### Step 1 · Install Tampermonkey

Search "Tampermonkey" in the Edge / Chrome / Firefox add-on store and install in one click.

### Step 2 · Install the script

```text
Open bili-subtitle.user.js → copy all → Tampermonkey "New script" → paste → save
```

Or use the CDN install link (auto-update depends on it):

```text
https://cdn.jsdelivr.net/gh/huanweide/bili-subtitle-universal@main/bili-subtitle.user.js
```

### Step 3 · Use it (if you only want official subtitles, stop here — no key needed)

Open any page with a video → a **🎬 Subtitle** pill appears bottom-right → open it → **⚡ Get Subtitles**.

```text
✔ hit official subtitles (Chinese · human) · 1,284 lines
  copied to clipboard
```

### Step 4 · Optional: configure an AI key (only needed for transcription / translation)

Get a key from any vendor with an OpenAI-compatible interface (default [SiliconFlow](https://cloud.siliconflow.cn/i/axOmWfWi), GitHub signup grants ¥16 credit), open the ⚙ settings panel → choose "AI vendor" → paste the `sk-` key → click "Test connection" to verify validity first (no quota spent) → click **🎙 AI Transcribe**.

```text
[4/5] transcribing · batch 12/107 · done 24:00 / 3:33:00
[00:24:03] the energy-level interleaving phenomenon we just mentioned
```

> ⚠️ "Auto-transcribe when no subtitles" is **off by default**: with no subtitles it only prompts, doesn't silently start, to avoid secretly burning your quota.

### Self-test: run the test battery locally

```bash
node --check bili-subtitle.user.js   # syntax
node tests/run-tests.js              # 86 unit tests
node tests/test-claims.js            # README promises → source evidence matrix
node tests/check-docs.js             # version / test-count must not drift
```

```text
Result: 86 passed, 0 failed
----------------------------------------
PASS 89 lines (all passed)
Result: all consistent (version 9.17.1 · cases 86)
```

---

## Command Reference

| Command | Purpose |
|---|---|
| `node tests/run-tests.js` | unit tests: MD5 / WBI / SRT / VTT / TTML / WAV / MIME / routing / channels / long-audio hardening |
| `node tests/test-scorer.js` | candidate scoring / search-filter pure functions / transcript quality / resume state layer |
| `node tests/test-wiring.js` | wiring verification: modules must have both a definition and a caller; UI elements must exist on both sides |
| `node tests/test-route.js` | route identity (anchors / tracking params / P change) + export action dispatch, with negative assertions |
| `node tests/test-ui.js` | dark-mode coverage completeness / FAB visible text / accessibility / interaction feedback |
| `node tests/test-site.js` | site & page-shape claim / non-claim list / phishing domains / URL sanitization |
| `node tests/test-sub.js` | in-subtitle search / VTT·MD export / shortcuts / click-to-jump / AI prompts / timeline correction |
| `node tests/test-claims.js` | full feature verification matrix: every README promise must point to source evidence |
| `node tests/test-roundtrip.js` | export → re-parse round-trip consistency (SRT / VTT written then read back, line by line identical) |
| `node tests/check-docs.js` | doc-consistency gate: version / test-count drift turns red |
| `node build.js` | sync `modules/*.js` into the build:modules region of `bili-subtitle.user.js` |
| `node scripts/cdn-refresh.js` | ⚠️ run after every push: purge jsDelivr cache and verify CDN version |
| `node tests/serve.js` | local static server (8765) with `tests/test.html` for canary |

**Shortcuts**: `Alt+S` toggle panel · `Esc` collapse · `Ctrl/⌘+Enter` get subtitles (won't steal keys inside input boxes; can be fully disabled)

---

## Architecture

**One sentence**: subtitle extraction walks a **degradation chain** of "claim table → best-of-three sources → four-layer transcription fallback", rather than erroring out when one path fails. The key to long video isn't "faster" but **constant memory + resumable breakpoints**.

### Concepts

| Concept | Meaning |
|---|---|
| SiteMatch | table of site + page-shape rules; no player → not claimed |
| Video identity (RouteIdentity) | only a "real video / P change" counts; anchors and tracking params don't |
| Four-layer fallback (ladder) | segmented decode → whole upload → decoded slices → silent playback recording, degrades layer by layer |
| Segment breakpoint (SegResume) | each ~2-min batch written on completion; re-transcription skips completed batches |
| Candidate scorer | native subtitles first → default-weight scoring → play count, to improve hit rate and spend less |
| Quality three-layer (TranscriptQuality) | hotword injection / LLM correction / punctuation-split dedup, toggle as needed |
| Evidence matrix (test-claims) | every README promise must point to a line of source |

### Main flow

```text
Open page
   │
   ├─ Claim table: does this page have a player? ── no ─► no button (no disturbance)
   │
   └─ yes ─► ⚡ Get Subtitles
              │
              ├─ Bilibili: WBI signature → human subtitles before AI → Chinese first
              ├─ YouTube: parse player response → both TTML timestamp forms
              └─ generic site: scan every <video>'s <track> → WebVTT / SRT
              │
              ├─ subtitles exist ─► parse → text box (searchable / click-to-jump / timeline-correctable) → export
              │
              └─ none ─► 🎙 AI transcribe
                             get audio URL
                              ├─ has segment list ─► ① segmented decode (preferred)
                              ├─ ≤40MB ─────► ② whole upload
                              └─ otherwise ──► ③ decoded slices → ④ silent playback recording
                             each batch done ─► SegResume to disk ─► progress bar / live subtitle stream / ETA
                             interrupted restart ─► skip completed batches
```

### Core modules

| Module | File | Responsibility |
|---|---|---|
| Main script | `bili-subtitle.user.js` | panel UI, subtitle fetch, transcription orchestration, export, settings |
| Claim table | `modules/site-match.js` | site & page-shape recognition + video-id extraction and sanitization |
| Route identity | `modules/route-identity.js` | decide "did the video change", anchors don't misfire |
| Resume | `modules/seg-resume.js` | batch completion write / load / clean, 24h TTL |
| Candidate scorer | `modules/candidate-scorer.js` | search-result ranking (subtitles first) |
| Search filter | `modules/search-filter.js` | Bilibili WBI search / YouTube Data API |
| Quality three-layer | `modules/transcript-quality.js` | punctuation restoration, sentence merge, dedup |
| Export | `modules/sub-export.js` | TXT / SRT / VTT / MD and the search-filtered export scope |

---

## Add Your Own Site / Vendor

**Add a site**: add a rule to the table in `modules/site-match.js` (site + path shape + video-id extraction method), then add a claim assertion to `tests/test-site.js` — claiming wrong hurts trust more than not claiming, so a test is mandatory.

```js
// modules/site-match.js (illustrative; fields per source)
{ host: /example\.com$/, path: /^\/play\/(\w+)/, pick: (m) => m[1] }
```

**Add an AI vendor**: add a preset to `AI_PROVIDERS` in `bili-subtitle.user.js`:

```js
myvendor: {
  label: 'My Vendor',
  base: 'https://api.example.com/v1',
  audio: '/audio/transcriptions', chat: '/chat/completions',
  supportsAudio: true, supportsHotwords: false,   // capability flags decide whether UI offers the button
  keyPlaceholder: 'sk-...',
  asrModels: ['my-asr-model'], chatModels: ['my-chat-model']
}
```

When `supportsAudio` is `false` (e.g. DeepSeek), the panel clearly says "this vendor provides no speech-transcription endpoint, translation only" — so you don't click transcribe and eat a 404.

---

## JS or Python? How to choose between the two subtitle projects

The same author maintains two subtitle projects, **with non-overlapping positioning — don't pick wrong**:

| | **This repo · bili-subtitle-universal** (JS userscript) | [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor) (Python CLI) |
|---|---|---|
| Form | click in the browser | one command in the terminal |
| Coverage | **Bilibili + YouTube + any webpage `<video>`** | Bilibili focused |
| Batch | single current page | **one command handles multiple BVs / `--page all`** |
| Dependency | Tampermonkey + browser | **Python 3.10+ standard library, zero pip install** |
| Automation | needs human on the page | **scriptable / scheduled / CI** |
| Output | copy / TXT / SRT / VTT / MD / AI text / anchor transcript | SRT + TXT + JSON trio on disk |

> **If you want "batch, offline, scriptable" — use the Python version [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor).**
> **If you want "open a webpage and click, also covering YouTube / any webpage" — use this repo.**

---

## FAQ

**Q: "API Key not configured"?** Official subtitles need no key. For transcription, paste an `sk-` key in ⚙ settings.

**Q: How long does transcription take?** The segmented-decode path (preferred) spends only tens of seconds on audio processing; total time is basically the recognition service's time.

**Q: Will there be sound during transcription?** No. Segmented decode doesn't play at all; the fallback paths are fully silent (gain 0).

**Q: Why can't YouTube with no subtitles be transcribed?** YouTube audio is signed-segment streaming; the script can't get the raw track and will suggest using official auto-subtitles (already supported). `MSE` / `blob:`-protected videos are the same.

**Q: Does Bilibili need login?** AI subtitles usually do (your browser's existing login state is enough); human subtitles usually don't.

**Q: Subtitle timeline off?** Panel "⏱ Timeline" → "Global offset" fills seconds (positive if it's late); the export timestamps shift as a whole; the start won't go negative and won't compress entries to 0s.

**Q: Thousands of lines but you only want a few?** Use the search box above the text box; type to filter, multi-word space-separated is "AND" semantics; **after search, all exports output only matched lines**.

**Q: Clicked "02:00" in comments, are subtitles still there?** Yes. `?t=` and share-attribution params don't count toward video change.

---

## Security Boundary

- **Pure-frontend**: no backend server; settings and API keys live only in the browser's local sandbox, never uploaded to any third party.
- **No video download, no transcoding**: it only handles subtitle text, not video download or cracking — not a "downloader".
- **Doesn't log in for you**: AI subtitles rely on your browser's existing Bilibili login state; the script doesn't log in.
- **Transparent billing**: AI transcription / translation spends your own quota; long videos use segmented breakpoints precisely to spend less; if you don't want to spend, use free official subtitles only.
- **Content responsibility**: extracted subtitles are for personal study and accessibility assistance only; comply with copyright law and platform rules.

---

## Roadmap

- ✅ v9.0 segmented decode · v9.4 segmented resume · v9.6 anchor no-misfire · v9.7 dark mode
- ✅ v9.8 claim table · v9.9 in-subtitle search + VTT/MD · v9.10 click-to-jump + AI summary prompt
- ✅ v9.11 timeline correction · v9.12 round-trip consistency · v9.14 switchable AI vendors · v9.17 auto-transcribe off by default
- ⬜ **v9.13 (next)**: real-site subtitle corpus regression set (fixtures)
- ⬜ YouTube audio de-stream signing (so no-subtitle videos can also be transcribed)
- ⬜ More sites: Xigua / Tencent Video / Weibo Video / Vimeo
- ⬜ ASS / LRC export, bilingual side-by-side export

Tell us in [Issues](https://github.com/huanweide/bili-subtitle-universal/issues) which one you want most.

---

## Contributing

1. Fork → branch → change code
2. Run the test battery (`node tests/run-tests.js` etc., see [Command Reference](#command-reference))
3. When bumping `@version`, **change the README version badge + CHANGELOG together** (`check-docs.js` blocks drift)
4. After push, **must run** `node scripts/cdn-refresh.js` — jsDelivr caches `@main` for 12 hours; without refresh users get the old version

When adding a publicly-advertised feature, add an evidence assertion in `tests/test-claims.js`: **every README promise must point to a line of source**.

---

## License

MIT — see [LICENSE](LICENSE). Bilibili, YouTube, etc. names are trademarks of their respective owners.

---

## Star

If this script saved you from typing subtitles by hand once, **a Star is the best reward** — it's also the only way more people find this project.

**Author**: huanweide ([github.com/huanweide](https://github.com/huanweide)) · MIT · © 2026

**Other tools by the same author** (a Star is appreciated ⭐):

- 🐍 [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor) · Bilibili subtitle Python CLI (batch / scriptable)
- 🔴 [live-subtitle](https://github.com/huanweide/live-subtitle) · live / meeting real-time Chinese subtitles (local recognition)
- 🎓 [zhihuishu-helper](https://github.com/huanweide/zhihuishu-helper) · Zhihuishu course auto-play / resume
- ✂️ [video-brief](https://github.com/huanweide/video-brief) · video content summary
- 🩺 [family-showcase](https://github.com/huanweide/family-showcase) · code-health tools hub
- 📦 [All repositories](https://github.com/huanweide?tab=repositories)
