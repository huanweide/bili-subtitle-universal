**中文** · [README.md](./README.md)

<p align="center">
  <img src="assets/banner.svg" alt="bili-subtitle-universal — universal video subtitle extraction">
</p>

# 🎬 Universal video subtitle extraction · AI transcription edition

> **Not "yet another Bilibili subtitle script" — it's the one that still produces text when there are no subtitles.**
> Grabs official subtitles instantly when present; when absent, transcribes with AI — **a 3-hour video still runs to completion reliably**.

[![CI](https://github.com/huanweide/bili-subtitle-universal/actions/workflows/test.yml/badge.svg)](https://github.com/huanweide/bili-subtitle-universal/actions/workflows/test.yml)
[![version](https://img.shields.io/badge/version-9.17.1-FB7299)](https://github.com/huanweide/bili-subtitle-universal)
[![license](https://img.shields.io/badge/license-MIT-4ecca3)](LICENSE)
[![tests](https://img.shields.io/badge/tests-86%2F86-3a8ee6)](tests/run-tests.js)
[![userscript](https://img.shields.io/badge/Tampermonkey-Edge%20%7C%20Chrome%20%7C%20Firefox-7C5CBF)](https://www.tampermonkey.net/)

**Automated flow**: `open video page → 🎬 open panel → ⚡ get subtitles → (no subtitles) 🎙 AI transcription → 📋 copy / ⬇ SRT·VTT·MD`

[30-second overview](#30-second-overview) · [What it does](#what-it-does) · [Features](#features) · [Quick start](#quick-start) · [Architecture](#architecture) · [Boundaries](#security-boundary) · [Roadmap](#roadmap) · [Contributing](#contributing)

---

## 30-second overview

```text
Before · a 3-hour lecture video with no subtitles
─────────────────────────────────────────────
  You       pause-and-type along, by hand          →  all night
  Other scripts  "this video has no subtitles" then nothing  →  dead end
  This script    🎙 AI transcription → segmented decode → resume →  after 3h you have a full transcript

After · what actually happens in the terminal
─────────────────────────────────────────────
$ open https://www.bilibili.com/video/BV…
  a "🎬 subtitles" pill appears at bottom-right

$ click "⚡ get subtitles"
  ✔ hit official subtitles (Chinese·human) · 1,284 lines      ← no Key, no cost, instant

$ if no subtitles → click "🎙 AI transcription"
  ① download  ② read duration  ③ segment-decode  ④ transcribe  ⑤ merge
  audio 86MB · duration 3:33:00 · processed 1:12:30 / 3:33:00 · used 2:14 · ETA 4:06
  [00:00:03] Hello, welcome to this episode
  [00:00:08] Last time we covered electron configuration
  [00:00:15] Now look at the second main group

$ export
  📋 copy · ⬇ TXT (BOM) · ⬇ SRT · ⬇ VTT · ⬇ MD · 🤖 AI text · ⚓ anchored draft
```

**The one-line difference**: other tools stop at "grab official subtitles"; this script turns the "no subtitles" dead end into a live path.

---

## What it does

**Scenario 1 · Bilibili course notes** (uploader posted no subtitles)

```
User: open the BV-numbered course page
  → claim: /video/BV… matches the Bilibili rule table (modules/site-match.js)
  → get subtitles: WBI-signed official API → no subtitles
  → fallback: read DASH segment list → download + decode per segment → send to ASR every 2 min
  → write: TXT / SRT, resumable
```

**Scenario 2 · YouTube transcript**

```
User: open youtube.com/watch?v=…
  → claim: /watch?v= matches the YouTube rule table
  → parse subtitle tracks from the player response (both TTML timestamp forms)
  → auto subtitles labeled AI; export SRT / VTT for the player
```

**Scenario 3 · someone's blog-embedded player / any webpage `<video>`**

```
User: open a page embedding player.bilibili.com/player.html
  → claim: iframe-embedded player (since v9.8) → read BV from URL params
  → generic site: scan all <video>, look for <track kind="subtitles|captions">
  → parse WebVTT / SRT
```

---

## Features

- **SiteMatch engine** — site & page-shape recognition centralized into one testable table instead of scattered regex; pages with no player are never claimed — claiming but failing to fetch hurts trust more than not claiming. See `modules/site-match.js`.
- **Four-layer transcription fallback ladder** — segmented decode (preferred, no playback, constant memory) → whole-file upload (≤40MB) → decoded slice (16kHz) → silent-playback recording (last resort); if one path fails, it drops to the next, no single blockage kills it.
- **Segment resume gate (SegResume)** — every ~2-minute batch of audio is written to disk as soon as transcribed; refresh / misclose / disconnect re-transcribes and skips what's done — **no paying twice**; resume keyed by "BV + P-number + audio URL", valid 24h.
- **Vendor-agnostic layer (AI_PROVIDERS)** — transcription and translation vendors are swappable (SiliconFlow / OpenAI / DeepSeek / OpenRouter / custom OpenAI-compatible endpoint); Key and model editable in settings; DeepSeek is explicitly marked as having no audio endpoint, avoiding a 404 when you click transcribe.
- **Three-layer quality (TranscriptQuality)** — layer 1 hotword injection (words from the video's own title/description/tags, **free**, no auto-downgrade) → layer 2 LLM correction (off by default, billed per call, rejects the whole batch on any order/item change) → layer 3 punctuation restore + sentence merge + adjacent-duplicate dedup (on by default).
- **Search-as-scope** — in-subtitle search with multi-word "AND" semantics; when N lines match, copy / TXT / SRT / VTT / AI text / anchored draft all output only the matched lines; when nothing matches it falls back to full text rather than handing you an empty file.
- **Anchor immune system (RouteIdentity)** — `?t=120` / `spm_id_from` / `vd_source` never count as "video changed"; only a real video or P-number swap resets; clicking a comment timestamp no longer clears subtitles.
- **Evidence-matrix gate (test-claims)** — every README claim must point to a line of source as evidence; **if written but not implemented, the test goes red**.
- **Pure-frontend boundary (default)** — no server; settings and API Key live only in the Tampermonkey local sandbox; no code path fetches your own service (guarded by an assertion).

---

## Quick start

### Step 1 · Install Tampermonkey

Search "Tampermonkey" in the Edge / Chrome / Firefox add-on store and install in one click.

### Step 2 · Install the script

```
Open bili-subtitle.user.js → copy all → Tampermonkey "New script" → paste → save
```

Or use the CDN install link (auto-update depends on it):

```
https://cdn.jsdelivr.net/gh/huanweide/bili-subtitle-universal@main/bili-subtitle.user.js
```

### Step 3 · Use it (if you only need official subtitles, stop here — no Key needed)

Open any video page → a **🎬 subtitles** pill appears bottom-right → open it → **⚡ get subtitles**.

```
✔ hit official subtitles (Chinese·human) · 1,284 lines
  copied to clipboard
```

### Step 4 · Optional: configure an AI Key (only needed for transcription / translation)

Get a Key from any vendor with an OpenAI-compatible endpoint (default [SiliconFlow](https://cloud.siliconflow.cn/i/axOmWfWi), GitHub signup gives ¥16 credit), open panel ⚙ settings → pick "AI vendor" → paste the `sk-` Key → click "test connection" to verify validity first (no quota spent) → click **🎙 AI transcription**.

```
[4/5] transcribing · batch 12/107 · done 24:00 / 3:33:00
[00:24:03] this energy-level interleaving phenomenon we just mentioned
```

> ⚠️ "Auto-transcribe when no subtitles" is **off by default**: with no subtitles it only prompts, never silently starts, to avoid quietly burning your quota.

### Self-test: run the battery locally

```bash
node --check bili-subtitle.user.js   # syntax
node tests/run-tests.js              # 86 unit tests
node tests/test-claims.js            # README claim → source evidence matrix
node tests/check-docs.js             # version / test-count must not drift
```

```
Result: 86 passed, 0 failed
----------------------------------------
PASS 89 assertions (all passed)
Result: all consistent (version 9.17.1 · 86 cases)
```

---

## Command reference

| Command | Purpose |
|---|---|
| `node tests/run-tests.js` | Unit tests: MD5 / WBI / SRT / VTT / TTML / WAV / MIME / routing / channels / long-audio hardening |
| `node tests/test-scorer.js` | Candidate scoring / search-filter pure functions / transcription quality / resume-state layer |
| `node tests/test-wiring.js` | Wiring check: a module must be both defined and called; UI elements must exist on both sides |
| `node tests/test-route.js` | Route identity (anchors / tracking params / P-swap) + export-action dispatch, with reverse assertions |
| `node tests/test-ui.js` | Dark-mode coverage completeness / FAB visible text / accessibility / interaction feedback |
| `node tests/test-site.js` | Site & page-shape claim / non-claim list / phishing domains / URL sanitizing |
| `node tests/test-sub.js` | In-subtitle search / VTT·MD export / shortcuts / click-jump / AI prompt / timeline correction |
| `node tests/test-claims.js` | Full feature verification matrix: every README claim must point to source evidence |
| `node tests/test-roundtrip.js` | Export → re-parse round-trip consistency (SRT / VTT written then read back, line-by-line identical) |
| `node tests/check-docs.js` | Doc-consistency gate: version / test-count drift turns red |
| `node build.js` | Sync `modules/*.js` into the build:modules region of `bili-subtitle.user.js` |
| `node scripts/cdn-refresh.js` | ⚠️ must run after every push: purge jsDelivr cache and verify CDN version |
| `node tests/serve.js` | Local static server (8765) with `tests/test.html` for gray testing |

**Shortcuts**: `Alt+S` open/close panel · `Esc` collapse · `Ctrl/⌘+Enter` get subtitles (won't steal keys inside input boxes; can be fully disabled)

---

## Architecture

**In one line**: subtitle extraction walks a **degradation chain** of "claim table → pick best of three sources → four-layer transcription fallback" rather than erroring when one path fails. The key to long videos is not "faster" but **constant memory + resumable segments**.

### Primitives

| Concept | Meaning |
|---|---|
| SiteMatch (claim table) | Rules for site + page shape; no player → not claimed |
| RouteIdentity (video identity) | Only a "real video / P-swap" counts as changed; anchors and tracking params don't |
| Fallback ladder (4 layers) | Segmented decode → whole upload → decoded slice → silent-playback recording, degrading layer by layer |
| SegResume (segment resume) | Each ~2-min audio batch written on completion; re-run skips finished batches |
| CandidateScorer | Native subtitles first → default-weight scoring → play count, to raise hit rate and spend less |
| TranscriptQuality (3 layers) | Hotword injection / LLM correction / punctuation-dedup, toggled as needed |
| Evidence matrix (test-claims) | Every README sentence must point to a line of source |

### Main flow

```text
Open page
   │
   ├─ Claim table: does this page have a player? ── no ─► no button (no interruption)
   │
   └─ yes ─► ⚡ get subtitles
              │
              ├─ Bilibili: WBI sign → human subtitles before AI subtitles → Chinese first
              ├─ YouTube: player-response parse → both TTML timestamp forms
              └─ Generic: scan all <video> <track> → WebVTT / SRT
              │
              ├─ has subtitles ─► parse → text box (searchable / click-jump / timeline-correctable) → export
              │
              └─ no subtitles ─► 🎙 AI transcription
                             get audio URL
                              ├─ has segment list ─► ① segmented decode (preferred)
                              ├─ ≤40MB ─────────► ② whole upload
                              └─ otherwise ──────► ③ decoded slice → ④ silent-playback recording
                             each batch done ─► SegResume write ─► progress bar / live subtitle stream / ETA
                             interrupt & retry ─► skip finished batches
```

### Core modules

| Module | File | Responsibility |
|---|---|---|
| Main script | `bili-subtitle.user.js` | Panel UI, subtitle fetch, transcription orchestration, export, settings |
| Claim table | `modules/site-match.js` | Site & page-shape recognition + video-id extraction & sanitizing |
| Route identity | `modules/route-identity.js` | Decide "did the video change", anchors don't false-trigger |
| Resume | `modules/seg-resume.js` | Batch write/load/clean, 24h TTL |
| Candidate scorer | `modules/candidate-scorer.js` | Search-result ranking (subtitles first) |
| Search filter | `modules/search-filter.js` | Bilibili wbi search / YouTube Data API |
| Quality 3-layer | `modules/transcript-quality.js` | Punctuation restore, sentence merge, dedup |
| Export | `modules/sub-export.js` | TXT / SRT / VTT / MD and post-search-filter export scope |

---

## Add your own site / vendor

**Add a site**: add a rule to the table in `modules/site-match.js` (site + path shape + video-id extraction), then add a claim assertion to `tests/test-site.js` — claiming wrong hurts trust more than not claiming, so a test is mandatory.

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
  supportsAudio: true, supportsHotwords: false,   // capability flags drive the UI
  keyPlaceholder: 'sk-...',
  asrModels: ['my-asr-model'], chatModels: ['my-chat-model']
}
```

When `supportsAudio` is `false` (e.g. DeepSeek), the panel clearly says "this vendor has no speech-transcription endpoint, translation only", so you never click transcribe and eat a 404.

---

## 🎬 or 🐍? Two subtitle projects, how to choose

The same author maintains two subtitle projects, **with non-overlapping positioning — don't pick wrong**:

| | **This repo · bili-subtitle-universal** (JS userscript) | [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor) (Python CLI) |
|---|---|---|
| Form | Click in the browser | One command in the terminal |
| Coverage | **Bilibili + YouTube + any webpage `<video>`** | Bilibili-focused |
| Batch | Single current page | **One command handles multiple BVs / `--page all`** |
| Dependency | Tampermonkey + browser | **Python 3.10+ standard library, zero pip install** |
| Automation | Needs manual page interaction | **Scriptable / cron / CI** |
| Output | Copy / TXT / SRT / VTT / MD / AI text / anchored draft | SRT + TXT + JSON trio on disk |

> **If you want "batch, offline, scriptable" — use the Python [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor).**
> **If you want "open a page and click, plus YouTube / any webpage coverage" — use this repo.**

---

## FAQ

**Q: "API Key not configured"?** Official subtitles need no Key. For transcription, paste an `sk-` Key in ⚙ settings.

**Q: How long does transcription take?** The preferred segmented-decode path spends only tens of seconds on audio processing; total time is basically the recognition service's time.

**Q: Will there be sound during transcription?** No. Segmented decode never plays; the fallback routes are fully silent (gain 0).

**Q: Why can't YouTube with no subtitles be transcribed?** YouTube audio is signed-streamed media; the script can't get the raw track and will suggest using official auto-subtitles (already supported). `MSE` / `blob:`-protected videos are the same.

**Q: Does Bilibili need login?** AI subtitles usually need it (your existing browser login state is enough); human subtitles usually don't.

**Q: Subtitle timeline off?** Panel "⏱ timeline" → "global offset" enter seconds (positive if late); export timestamps shift as a whole; the start never goes negative and entries never collapse to 0s.

**Q: Thousands of lines but only want a few?** Use the search box above the text area; type to filter, space-separated words are "AND"; **after search, all exports output only matched lines**.

**Q: Clicked "02:00" in comments, are subtitles still there?** Yes. `?t=` and share-attribution params don't count as video change.

---

## Security boundary

- **Pure-frontend**: no backend server; settings and API Key live only in the browser's local sandbox, uploaded to no third party.
- **No video download, no transcoding**: it only processes subtitle text, not video download or cracking — it is not a "downloader".
- **Does not log in for you**: AI subtitles rely on your existing Bilibili login state in the browser; the script does no login.
- **Transparent billing**: AI transcription / translation spend your own quota; long videos use segmented resume precisely to spend less; don't want to spend, use free official subtitles only.
- **Content responsibility**: extracted subtitles are for personal study and accessibility assistance only; please obey copyright law and platform rules.

---

## Roadmap

- ✅ v9.0 segmented decode · v9.4 segment resume · v9.6 anchors don't false-trigger · v9.7 dark mode
- ✅ v9.8 claim table · v9.9 in-subtitle search + VTT/MD · v9.10 click-jump + AI summary prompt
- ✅ v9.11 timeline correction · v9.12 round-trip consistency · v9.14 swappable AI vendors · v9.17 auto-transcribe off by default
- ⬜ **v9.13 (next)**: real-site subtitle corpus regression set (fixtures)
- ⬜ YouTube audio stream-signature unpacking (transcribe even with no subtitles once unlocked)
- ⬜ More sites: Xigua / Tencent Video / Weibo Video / Vimeo
- ⬜ ASS / LRC export, bilingual side-by-side export

Tell us in [Issues](https://github.com/huanweide/bili-subtitle-universal/issues) which you want most.

---

## Contributing

1. Fork → branch → change code
2. Run the test battery (`node tests/run-tests.js` etc., see [Command reference](#command-reference))
3. When bumping `@version`, **also update the README version badge + CHANGELOG together** (`check-docs.js` blocks drift)
4. After push, **must run** `node scripts/cdn-refresh.js` — jsDelivr caches `@main` for 12h; without refresh users get the old version

When adding a feature you publicize, add an evidence assertion in `tests/test-claims.js`: **every README claim must point to a line of source.**

---

## License

MIT — see [LICENSE](LICENSE). Bilibili, YouTube, etc. are trademarks of their respective owners.

---

## Star

If this script saved you from hand-typing subtitles once, **a Star is the best reward** — it's also the only way more people find this project.

**Author**: huanweide ([GitHub](https://github.com/huanweide)) · MIT · © 2026

**More tools by the same author** (a Star ⭐ is appreciated):

- 🐍 [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor) · Bilibili subtitle Python CLI (batch / scriptable)
- 🔴 [live-subtitle](https://github.com/huanweide/live-subtitle) · live / meeting real-time Chinese subtitles (local recognition)
- 🎓 [zhihuishu-helper](https://github.com/huanweide/zhihuishu-helper) · Zhihuishu course auto-play / resume
- ✂️ [video-brief](https://github.com/huanweide/video-brief) · video content brief
- 🩺 [family-showcase](https://github.com/huanweide/family-showcase) · code-health tool overview
- 📦 [All repos](https://github.com/huanweide?tab=repositories)
