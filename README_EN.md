**中文** · [README.md](./README.md)

<p align="center">
  <img src="assets/banner.svg" alt="bili-subtitle-universal — universal video subtitle extractor">
</p>

# 🎬 Universal video subtitle extractor · AI transcription

> **Not "yet another Bilibili subtitle script" — it's the one that still produces text when there are no subtitles.**
> Grabs official subtitles instantly when present; when there aren't any, it transcribes with AI — **and it churns through a 3-hour video reliably.**

[![CI](https://github.com/huanweide/bili-subtitle-universal/actions/workflows/test.yml/badge.svg)](https://github.com/huanweide/bili-subtitle-universal/actions/workflows/test.yml)
[![version](https://img.shields.io/badge/version-9.17.1-FB7299)](https://github.com/huanweide/bili-subtitle-universal)
[![license](https://img.shields.io/badge/license-MIT-4ecca3)](LICENSE)
[![tests](https://img.shields.io/badge/tests-86%2F86-3a8ee6)](tests/run-tests.js)
[![userscript](https://img.shields.io/badge/Tampermonkey-Edge%20%7C%20Chrome%20%7C%20Firefox-7C5CBF)](https://www.tampermonkey.net/)

**Flow**: `open video page → 🎬 open panel → ⚡ get subtitles → (no subtitles) 🎙 AI transcribe → 📋 copy / ⬇ SRT·VTT·MD`

[30-second tour](#30-second-tour) · [What it does](#what-it-does) · [Features](#features) · [Quick start](#quick-start) · [Architecture](#architecture) · [Security](#security-boundary) · [Roadmap](#roadmap) · [Contributing](#contributing)

---

## 30-second tour

```text
Before · a 3-hour lecture video with no subtitles
─────────────────────────────────────────────
  You            pause and type subtitles as you watch  →  all night
  Other scripts  "this video has no subtitles" and stops  →  dead end
  This script    🎙 AI transcribe → segmented decode → resume →  after 3h you have a full transcript

After · what actually happens in the terminal
─────────────────────────────────────────────
$ open https://www.bilibili.com/video/BV…
  a "🎬 subtitles" pill appears at the bottom-right

$ click "⚡ get subtitles"
  ✔ official subtitles hit (Chinese·human) · 1,284 lines   ← no key, no cost, instant

$ if no subtitles → click "🎙 AI transcribe"
  ① download  ② read duration  ③ segmented decode  ④ transcribe  ⑤ merge
  audio 86MB · duration 3:33:00 · processed 1:12:30 / 3:33:00 · used 2:14 · ETA 4:06
  [00:00:03] Hello, welcome to this episode
  [00:00:08] Last time we covered electron configuration
  [00:00:15] Now let's look at group 2

$ export
  📋 copy · ⬇ TXT (BOM) · ⬇ SRT · ⬇ VTT · ⬇ MD · 🤖 AI text · ⚓ anchored transcript
```

**The one-line difference**: other tools stop at "grab official subtitles"; this script turns the "no subtitles" dead end into a working path.

---

## What it does

**Scenario 1 · Take notes from a Bilibili course** (the UP host uploaded no subtitles)

```
User: open the BV-numbered course page
  → claim: /video/BV… matches the Bilibili rule table (modules/site-match.js)
  → fetch subtitles: WBI-signed official API → none
  → fallback: read DASH segment list → download + decode per segment → send to ASR every 2 min
  → save: TXT / SRT, resumable
```

**Scenario 2 · Get a transcript from a YouTube video**

```
User: open youtube.com/watch?v=…
  → claim: /watch?v= matches the YouTube rule table
  → parse subtitle tracks from the player response (TTML dual-timestamp fully supported)
  → auto subtitles labeled as AI, export SRT / VTT for the player
```

**Scenario 3 · A player embedded in someone's blog / any webpage `<video>`**

```
User: open a page embedding player.bilibili.com/player.html
  → claim: iframe-embedded player (since v9.8) → read BV number from URL params
  → generic site: walk all <video> on the page, scan <track kind="subtitles|captions">
  → parse WebVTT / SRT
```

---

## Features

- **Site-claim engine (SiteMatch)** — site + page-shape recognition is centralized into one testable table instead of scattered regex; pages with no player are never claimed (claiming but failing to fetch hurts trust more than not claiming). See `modules/site-match.js`.
- **Four-layer transcription fallback** — segmented decode (preferred, no playback, constant memory) → whole-file upload (≤40MB) → decode slice (16kHz) → silent playback recording (last resort); if one path fails it drops to the next — no single blockage kills it.
- **Resume gate (SegResume)** — each ~2-minute batch of audio is saved as soon as it's transcribed; refresh / accidental close / disconnect re-transcribes only the unfinished batches, **never paying twice**; resume keyed by "BV number + part number + audio URL", valid 24h.
- **Provider-agnostic layer (AI_PROVIDERS)** — transcription and translation providers are swappable (SiliconFlow / OpenAI / DeepSeek / OpenRouter / custom OpenAI-compatible endpoint); key and model edited in settings; DeepSeek is explicitly marked as having no audio endpoint to avoid a 404 when you click transcribe.
- **Three quality layers (TranscriptQuality)** — layer 1 hot-word injection (words from the video's own title/description/tags, **free**, no auto-downgrade if the account doesn't support it) → layer 2 LLM correction (off by default, billed per call, rejects the whole batch if entries/order change) → layer 3 punctuation restore + sentence merge + adjacent duplicate removal (on by default).
- **Search-as-scope** — in-subtitle multi-word "AND" search; the N matching lines are what copy / TXT / SRT / VTT / AI text / anchored transcript all output; if nothing matches it falls back to the full text rather than handing you an empty file.
- **Anchor immunity (RouteIdentity)** — `?t=120` / `spm_id_from` / `vd_source` never count as "video changed"; only a real video or part switch resets; clicking a comment timestamp never wipes your subtitles.
- **Evidence-matrix gate (test-claims)** — every claim the README makes must point to a line of source code; **if it's written but not implemented, the test goes red.**
- **Pure-frontend boundary (default)** — no server; settings and API keys live only in the Tampermonkey local sandbox; no code fetches your own backend (guarded by an assertion).

---

## Quick start

### Step 1 · Install Tampermonkey

Search "Tampermonkey" in the Edge / Chrome / Firefox add-on store and install in one click.

### Step 2 · Install the script

```text
Open bili-subtitle.user.js → copy all → Tampermonkey "New script" → paste → save
```

Or use the CDN install link (auto-update depends on it):

```
https://cdn.jsdelivr.net/gh/huanweide/bili-subtitle-universal@main/bili-subtitle.user.js
```

### Step 3 · Use it (if you only need official subtitles, stop here — no key needed)

Open any page with a video → a **🎬 subtitles** pill appears bottom-right → open it → **⚡ get subtitles**.

```text
✔ official subtitles hit (Chinese·human) · 1,284 lines
  copied to clipboard
```

### Step 4 · Optional: configure an AI key (only needed for transcribe / translate)

Get a key from any vendor with an OpenAI-compatible endpoint (default [SiliconFlow](https://cloud.siliconflow.cn/i/axOmWfWi), ¥16 trial credit on GitHub signup), open the ⚙ settings panel → pick "AI provider" → paste the `sk-`-prefixed key → click "Test connection" to validate first (no quota spent) → click **🎙 AI transcribe**.

```text
[4/5] transcribing · batch 12/107 · done 24:00 / 3:33:00
[00:24:03] the energy-level interleaving phenomenon we just mentioned
```

> ⚠️ "Auto-transcribe when no subtitles" is **off by default**: without subtitles it only prompts, never secretly spends your quota.

### Self-test: run the test battery locally

```bash
node --check bili-subtitle.user.js   # syntax
node tests/run-tests.js              # 86 unit tests
node tests/test-claims.js            # README claims → source evidence matrix
node tests/check-docs.js             # version number / test count must not drift
```

```text
Result: 86 passed, 0 failed
----------------------------------------
PASS 89 items (all passed)
Result: all consistent (version 9.17.1 · cases 86)
```

---

## Command reference

| Command | Purpose |
|---|---|
| `node tests/run-tests.js` | Unit tests: MD5 / WBI / SRT / VTT / TTML / WAV / MIME / route / channel / long-audio hardening |
| `node tests/test-scorer.js` | Candidate scoring / search filter pure functions / transcribe quality / resume state layer |
| `node tests/test-wiring.js` | Wiring check: modules must have both a definition and a caller; UI elements must exist on both sides |
| `node tests/test-route.js` | Route identity (anchor / tracking params / part switch) + export action dispatch, with reverse assertions |
| `node tests/test-ui.js` | Dark-mode coverage completeness / FAB visible text / accessibility / interaction feedback |
| `node tests/test-site.js` | Site + page-shape claim / non-claim list / phishing domains / URL sanitization |
| `node tests/test-sub.js` | In-subtitle search / VTT·MD export / shortcuts / click-jump / AI prompts / timeline correction |
| `node tests/test-claims.js` | Full-feature verification matrix: every README claim must trace to source evidence |
| `node tests/test-roundtrip.js` | Export → re-parse round-trip consistency (SRT / VTT written then read back, line by line identical) |
| `node tests/check-docs.js` | Doc-consistency gate: version number / test count drift turns red |
| `node build.js` | Sync `modules/*.js` into the build:modules region of `bili-subtitle.user.js` |
| `node scripts/cdn-refresh.js` | ⚠️ must run after every push: purge jsDelivr cache and verify the CDN version |
| `node tests/serve.js` | Local static server (8765) for灰度 with `tests/test.html` |

**Shortcuts**: `Alt+S` toggle panel · `Esc` collapse · `Ctrl/⌘+Enter` get subtitles (doesn't steal keys inside input boxes; can be fully disabled)

---

## Architecture

**In one line**: subtitle extraction walks a **degradation chain** of "claim table → pick best of three sources → four-layer transcription fallback", rather than erroring out when one path fails. For long videos the key isn't "faster" — it's **constant memory + resumable checkpoints**.

### Primitives

| Concept | Meaning |
|---|---|
| Claim table (SiteMatch) | Rules for site + page shape; no player → not claimed |
| Video identity (RouteIdentity) | Only a real video / part switch counts; anchors and tracking params don't |
| Four-layer fallback | Segmented decode → whole-file upload → decode slice → silent playback recording, degrading layer by layer |
| Segment resume (SegResume) | Each ~2-min audio batch saved on completion; re-run skips finished batches |
| Candidate scorer (CandidateScorer) | Native subtitle first → default-weight scoring → play count, to raise hit rate and spend less |
| Three quality layers (TranscriptQuality) | Hot-word injection / LLM correction / punctuation + merge + dedupe, toggled as needed |
| Evidence matrix (test-claims) | Every README claim must trace to a line of source |

### Main flow

```text
Open page
   │
   ├─ Claim table: does this page have a player? ── no ─► no button (no interruption)
   │
   └─ yes ─► ⚡ get subtitles
              │
              ├─ Bilibili: WBI signature → human subtitles before AI → Chinese first
              ├─ YouTube: player-response parse → TTML dual-timestamp
              └─ Generic: scan all <video> <track> → WebVTT / SRT
              │
              ├─ has subtitles ─► parse → text box (searchable / click-jump / timeline-correctable) → export
              │
              └─ no subtitles ─► 🎙 AI transcribe
                             get audio URL
                              ├─ has segment list ─► ① segmented decode (preferred)
                              ├─ ≤40MB ─────► ② whole-file upload
                              └─ otherwise ──► ③ decode slice → ④ silent playback recording
                             each batch done ─► SegResume save ─► progress / live subtitle stream / ETA
                             resume ─► skip finished batches
```

### Core modules

| Module | File | Responsibility |
|---|---|---|
| Main script | `bili-subtitle.user.js` | Panel UI, subtitle fetch, transcribe orchestration, export, settings |
| Claim table | `modules/site-match.js` | Site + page-shape recognition + video-number extraction and sanitization |
| Route identity | `modules/route-identity.js` | Decide "did the video change", anchors don't misfire |
| Resume | `modules/seg-resume.js` | Batch save / load / clean, 24h TTL |
| Candidate scorer | `modules/candidate-scorer.js` | Search result ranking (subtitles first) |
| Search filter | `modules/search-filter.js` | Bilibili wbi search / YouTube Data API |
| Quality layers | `modules/transcript-quality.js` | Punctuation restore, sentence merge, dedupe |
| Export | `modules/sub-export.js` | TXT / SRT / VTT / MD and post-search-filtered export scope |

---

## Add your own site / provider

**Add a site**: add one entry to the rule table in `modules/site-match.js` (site + path shape + video-number extraction), then add a claim assertion to `tests/test-site.js` — a wrong claim hurts trust more than none, so it must be tested.

```js
// modules/site-match.js (illustrative; fields per source)
{ host: /example\.com$/, path: /^\/play\/(\w+)/, pick: (m) => m[1] }
```

**Add an AI provider**: add a preset to `AI_PROVIDERS` in `bili-subtitle.user.js`:

```js
myvendor: {
  label: 'My Vendor',
  base: 'https://api.example.com/v1',
  audio: '/audio/transcriptions', chat: '/chat/completions',
  supportsAudio: true, supportsHotwords: false,   // capability flags drive UI toggles
  keyPlaceholder: 'sk-...',
  asrModels: ['my-asr-model'], chatModels: ['my-chat-model']
}
```

When `supportsAudio` is `false` (e.g. DeepSeek), the panel clearly says "this vendor has no speech-transcription endpoint, translate only" — so you never click transcribe and eat a 404.

---

## 🎬 or 🐍 · which of the two subtitle projects

The same author maintains two subtitle projects, **non-overlapping in scope — don't pick wrong**:

| | **This repo · bili-subtitle-universal** (JS userscript) | [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor) (Python CLI) |
|---|---|---|
| Form | Click in the browser | One command in the terminal |
| Coverage | **Bilibili + YouTube + any webpage `<video>`** | Bilibili-focused |
| Batch | Single current page | **One command handles many BVs / `--page all`** |
| Dependencies | Tampermonkey + browser | **Python 3.10+ stdlib, zero pip install** |
| Automation | Manual page interaction | **Scriptable / scheduled / CI** |
| Output | Copy / TXT / SRT / VTT / MD / AI text / anchored | SRT + TXT + JSON trio on disk |

> **If you want "batch, offline, scriptable" — use the Python [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor).**
> **If you want "open a page and click, plus YouTube / any webpage coverage" — use this repo.**

---

## FAQ

**Q: "API Key not configured"?** Official subtitles need no key. For transcription, paste a `sk-`-prefixed key in ⚙ settings.

**Q: How long does transcription take?** The segmented-decode path (preferred) spends only tens of seconds on audio processing; total time is basically the recognition service's time.

**Q: Will there be sound during transcription?** No. Segmented decode doesn't play at all; the fallback path is silent throughout (gain 0).

**Q: Why can't YouTube with no subtitles be transcribed?** YouTube audio is signed-segment streaming; the script can't get the raw track and will suggest using official auto-subtitles (which it already supports). The same applies to `MSE` / `blob:`-protected videos.

**Q: Does Bilibili require login?** AI subtitles usually do (your browser's existing login state is enough); human subtitles usually don't.

**Q: Subtitle timeline off?** Panel "⏱ Timeline" → "Global offset" enter seconds (positive for late); exported timestamps shift as a whole; the start never goes negative and entries never get crushed to 0s.

**Q: Thousands of lines but you only want a few?** Use the search box above the text area; type to filter instantly, multiple words separated by spaces mean "AND"; **after searching, every export outputs only the matching lines.**

**Q: Clicked "02:00" in comments — are subtitles still there?** Yes. `?t=` and share-attribution params don't count as a video switch.

---

## Security boundary

- **Pure-frontend**: no backend server; settings and API keys live only in the browser's local sandbox, never uploaded to any third party.
- **No video download, no transcoding**: it only processes subtitle text — not a "downloader", no cracking.
- **Doesn't log in for you**: AI-subtitle fetch relies on your browser's existing Bilibili login state; the script doesn't log in.
- **Transparent billing**: AI transcription / translation spends your own quota; long videos use segmented resume precisely to spend less; don't want to spend → use free official subtitles only.
- **Content responsibility**: extracted subtitles are for personal study and accessibility assistance only; please comply with copyright law and platform rules.

---

## Roadmap

- ✅ v9.0 segmented decode · v9.4 segment resume · v9.6 anchors don't misfire · v9.7 dark mode
- ✅ v9.8 claim table · v9.9 in-subtitle search + VTT/MD · v9.10 click-jump + AI summary prompt
- ✅ v9.11 timeline correction · v9.12 round-trip consistency · v9.14 swappable AI providers · v9.17 auto-transcribe off by default
- ⬜ **v9.13 (next)**: real-site subtitle corpus regression set (fixtures)
- ⬜ YouTube audio de-stream signing (transcribe even with no subtitles once unlocked)
- ⬜ More sites: Xigua / Tencent Video / Weibo Video / Vimeo
- ⬜ ASS / LRC export, bilingual side-by-side export

Tell us in [Issues](https://github.com/huanweide/bili-subtitle-universal/issues) which you want most.

---

## Contributing

1. Fork → branch → change code
2. Run the test battery (`node tests/run-tests.js` etc., see [Command reference](#command-reference))
3. When bumping `@version`, **change the README version badge + CHANGELOG together** (`check-docs.js` will block drift)
4. After push, **must run** `node scripts/cdn-refresh.js` — jsDelivr caches `@main` for 12 hours; skip it and users get the old version

When adding a publicly-promoted feature, add an evidence assertion in `tests/test-claims.js`: **every README claim must trace to a line of source.**

---

## License

MIT — see [LICENSE](LICENSE). Bilibili, YouTube, and other names are trademarks of their respective owners.

---

## Star

If this script saved you from typing subtitles by hand once, **a Star is the best thanks** — it's also the only way more people find this project.

**Author**: huanweide ([@huanweide](https://github.com/huanweide)) · MIT · © 2026

**Other tools by the same author** (a Star ⭐ welcome):

- 🐍 [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor) · Bilibili subtitle Python CLI (batch / scriptable)
- 🔴 [live-subtitle](https://github.com/huanweide/live-subtitle) · live / meeting real-time Chinese subtitles (local recognition)
- 🎓 [zhihuishu-helper](https://github.com/huanweide/zhihuishu-helper) · Zhihuishu course auto-play / resume
- ✂️ [video-brief](https://github.com/huanweide/video-brief) · video content brief
- 🩺 [family-showcase](https://github.com/huanweide/family-showcase) · code-health tools overview
- 📦 [All repos](https://github.com/huanweide?tab=repositories)
