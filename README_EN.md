<p align="center">
  <img src="assets/banner.svg" alt="bili-subtitle-universal">
</p>

# 🎬 Universal Video Subtitle Extractor · AI Transcription

> **Not "another Bilibili subtitle script" — the one that still works when there is no subtitle.**
> Grabs official subtitles instantly; when none exist, transcribes with AI. **A 3-hour video runs to completion.**

[![CI](https://github.com/huanweide/bili-subtitle-universal/actions/workflows/test.yml/badge.svg)](https://github.com/huanweide/bili-subtitle-universal/actions/workflows/test.yml)
[![version](https://img.shields.io/badge/version-9.17.1-FB7299)](https://github.com/huanweide/bili-subtitle-universal)
[![license](https://img.shields.io/badge/license-MIT-4ecca3)](LICENSE)

**中文:** [README.md](README.md)

**Flow:** `open video → 🎬 panel → ⚡ Get Subtitles → (if none) 🎙 AI Transcribe → 📋 copy / ⬇ SRT·VTT·MD`

[30-Second Demo](#-30-second-demo) · [Features](#features) · [Quick Start](#quick-start) · [Architecture](#architecture) · [Boundary](#security-boundary) · [Which repo?](#-js-or-python) · [Star](#-star)

---

## 🎯 30-Second Demo

```text
Before · a 3-hour lecture with no subtitles
─────────────────────────────────────────────
  you          pause, rewind, type by hand       →  a whole evening
  other scripts  "no subtitles found" and stop   →  dead end
  this script    🎙 transcribe → segmented decode → resume on failure →  full transcript

After · what actually happens
─────────────────────────────────────────────
$ open https://www.bilibili.com/video/BV…
  a "🎬 Subtitles" pill appears bottom-right

$ click "⚡ Get Subtitles"
  ✔ official subtitle found (zh-CN, human) · 1,284 cues     ← no API key, instant

$ no subtitle? click "🎙 AI Transcribe"
  ① download  ② probe duration  ③ segmented decode  ④ transcribe  ⑤ merge
  audio 86MB · 3:33:00 · done 1:12:30 / 3:33:00 · elapsed 2:14 · ETA 4:06
  [00:00:03] Hello and welcome to this episode
  [00:00:08] Last time we covered electron configuration

$ export
  📋 copy · ⬇ TXT (BOM) · ⬇ SRT · ⬇ VTT · ⬇ MD · 🤖 AI text · ⚓ anchor script
```

---

## Features

- **Site Claim Table (SiteMatch)** — site + page-shape rules live in one testable table; pages without a player are never claimed. Claiming a page you cannot serve is worse than not claiming it (`modules/site-match.js`).
- **Four-Layer Transcription Ladder** — segmented decode (default; no playback, constant memory) → whole-file upload (≤40MB) → decoded slicing (16kHz) → muted playback recording (last resort). A blocked layer falls through to the next.
- **Resume Gate (SegResume)** — every ~2 minutes of audio is persisted as soon as it is transcribed; refresh, tab crash or network loss resumes from the checkpoint. **You never pay twice for the same audio.** Keyed by BV id + part + audio URL, 24h TTL.
- **Vendor-Agnostic Layer (AI_PROVIDERS)** — switch between SiliconFlow / OpenAI / DeepSeek / OpenRouter / any OpenAI-compatible endpoint. DeepSeek is explicitly flagged as audio-less so you never click "transcribe" into a 404.
- **Three Quality Layers (TranscriptQuality)** — hotword injection from the video's own title/description/tags (**free**, auto-disables if unsupported) → optional LLM correction (off by default, billed per call, batch rejected if item count/order changes) → punctuation restore + sentence merge + adjacent-duplicate removal (on by default).
- **Search-as-Export-Scope** — multi-word AND search inside the transcript; **only matched lines are copied/exported**. Zero matches falls back to the full text rather than an empty file.
- **Anchor Immunity (RouteIdentity)** — `?t=120`, `spm_id_from` and `vd_source` never count as "video changed"; only a real video or part switch resets state.
- **Evidence Matrix (test-claims)** — every promise in the README must point at a line of source. **Claim it without building it and CI goes red.**
- **Pure-Frontend Boundary** — no backend; settings and API keys stay in the Tampermonkey sandbox (an assertion enforces there is no fetch to a self-owned service).

---

## Quick Start

1. **Install Tampermonkey** — Edge / Chrome / Firefox extension store.
2. **Install the script** — open `bili-subtitle.user.js`, copy everything, paste into Tampermonkey → New script → save. Or install from CDN (auto-update depends on it):

   ```
   https://cdn.jsdelivr.net/gh/huanweide/bili-subtitle-universal@main/bili-subtitle.user.js
   ```

3. **Use it** — open any page with a video → click the **🎬 Subtitles** pill → **⚡ Get Subtitles**. No API key needed for official subtitles.
4. **Optional: AI key** (transcription/translation only) — get an OpenAI-compatible key (SiliconFlow is the default), paste it in ⚙ Settings → AI provider → "Test connection" (free) → **🎙 AI Transcribe**.

> ⚠️ "Auto-transcribe when no subtitle" is **off by default** — the script will never silently spend your credits.

### Run the test battery locally

```bash
node --check bili-subtitle.user.js   # syntax
node tests/run-tests.js              # 86 unit tests
node tests/test-claims.js            # README promise -> source evidence matrix
node tests/check-docs.js             # version / test-count drift gate
```

```text
86 passed, 0 failed
PASS 89/89
all consistent (version 9.17.1 · cases 86)
```

---

## Command Reference

| Command | Purpose |
|---|---|
| `node tests/run-tests.js` | Unit tests: MD5 / WBI / SRT / VTT / TTML / WAV / MIME / routing / channels / long-audio hardening |
| `node tests/test-scorer.js` | Candidate scoring, search-filter pure functions, quality layers, resume state |
| `node tests/test-wiring.js` | Wiring: a defined module must also have a caller; UI elements must exist on both sides |
| `node tests/test-route.js` | Route identity (anchors / tracking params / part switch) + export dispatch, with reverse assertions |
| `node tests/test-ui.js` | Dark-mode coverage, FAB visible label, a11y, interaction feedback |
| `node tests/test-site.js` | Site/page-shape claims, never-claim list, phishing domains, URL sanitisation |
| `node tests/test-sub.js` | In-transcript search, VTT/MD export, hotkeys, click-to-seek, AI prompts, timeline offset |
| `node tests/test-claims.js` | Full capability matrix: every README claim must be provable in source |
| `node tests/test-roundtrip.js` | Export → re-parse round-trip (SRT / VTT must match cue by cue) |
| `node tests/check-docs.js` | Doc consistency: version badge and test count must not drift |
| `node build.js` | Sync `modules/*.js` into the `build:modules` block of the userscript |
| `node scripts/cdn-refresh.js` | ⚠️ run after every push: purge jsDelivr cache and verify the served version |

**Hotkeys:** `Alt+S` toggle panel · `Esc` collapse · `Ctrl/⌘+Enter` fetch subtitles (never steals keys while typing; can be disabled)

---

## Architecture

**In one line:** subtitle extraction runs a **degradation chain** — claim table → pick best of three sources → four-layer transcription ladder — instead of failing at the first blocked path. For long videos the win is not "faster", it is **constant memory + resumable batches**.

### Primitives

| Concept | Meaning |
|---|---|
| Claim table (SiteMatch) | Site + page-shape rules; no player → no claim |
| Route identity (RouteIdentity) | Only a real video/part switch counts; anchors and tracking params do not |
| Four-layer ladder | Segmented decode → whole-file → decoded slicing → muted playback recording |
| Segment resume (SegResume) | Persist each ~2-minute batch; skip finished batches on retry |
| Candidate scorer | Native-subtitle-first → default-weight score → view count |
| Quality layers | Hotwords / LLM correction / punctuation + merge + dedupe |
| Evidence matrix | Every README promise points at a source line |

### Flow

```text
open page
   │
   ├─ claim table: does this page have a player? ── no ─► no button (never noisy)
   │
   └─ yes ─► ⚡ Get Subtitles
              ├─ Bilibili: WBI signature → human > AI subtitle → zh first
              ├─ YouTube: parse player response → TTML dual-form timestamps
              └─ generic: scan every <video> for <track> → WebVTT / SRT
              │
              ├─ subtitle found ─► parse → panel (search / click-to-seek / timeline fix) → export
              └─ none ─► 🎙 AI Transcribe
                           ├─ segment index present ─► ① segmented decode (default)
                           ├─ ≤40MB ─────────────────► ② whole-file upload
                           └─ otherwise ─────────────► ③ decoded slicing → ④ muted playback
                          each batch ─► SegResume persists ─► progress / live stream / ETA
                          interrupted ─► skip finished batches
```

### Core Modules

| Module | File | Responsibility |
|---|---|---|
| Main script | `bili-subtitle.user.js` | Panel UI, subtitle fetching, transcription orchestration, export, settings |
| Claim table | `modules/site-match.js` | Site/page-shape detection + video-id extraction & sanitisation |
| Route identity | `modules/route-identity.js` | Decides "did the video change?" without anchor false positives |
| Resume | `modules/seg-resume.js` | Persist / load / clear batch checkpoints, 24h TTL |
| Scoring | `modules/candidate-scorer.js` | Result ranking (subtitle-first) |
| Search filter | `modules/search-filter.js` | Bilibili wbi search / YouTube Data API |
| Quality | `modules/transcript-quality.js` | Punctuation restore, sentence merge, dedupe |
| Export | `modules/sub-export.js` | TXT / SRT / VTT / MD and the search-narrowed export scope |

---

## Extension: add a site or a vendor

Add a **site** in the rule table of `modules/site-match.js`, plus a claim assertion in `tests/test-site.js`.

Add a **vendor** in `AI_PROVIDERS` inside `bili-subtitle.user.js`:

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

When `supportsAudio` is `false` (e.g. DeepSeek), the panel says so explicitly instead of letting you hit a 404.

---

## 🎬 JS or 🐍 Python?

Two subtitle projects, **non-overlapping**:

| | **this repo** (JS userscript) | [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor) (Python CLI) |
|---|---|---|
| Shape | one click in the browser | one command in a terminal |
| Coverage | **Bilibili + YouTube + any `<video>`** | Bilibili focused |
| Batch | current page only | **many BV ids / `--page all` in one command** |
| Dependencies | Tampermonkey + browser | **Python 3.10+ stdlib, no pip install** |
| Automation | manual, in-page | **scriptable / cron / CI** |
| Output | copy / TXT / SRT / VTT / MD / AI text / anchor script | SRT + TXT + JSON on disk |

> **Need batch, offline, scriptable? Use [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor).**
> **Need one click in the browser, covering YouTube and arbitrary pages? Use this repo.**

---

## Security Boundary

- **Pure frontend.** No backend server; settings and API keys stay in the browser sandbox.
- **It does not download or transcode video.** Only subtitle text. Not a downloader or a bypass tool.
- **It does not log in for you.** AI subtitles rely on your existing Bilibili session.
- **Billing is transparent.** Transcription/translation spend your own credits; segmentation and resume exist to spend less.
- Use the output for personal study and accessibility, and respect copyright and platform rules.

---

## Roadmap

- ✅ v9.0 segmented decode · v9.4 resume · v9.6 anchor immunity · v9.7 dark mode
- ✅ v9.8 claim table · v9.9 in-transcript search + VTT/MD · v9.10 click-to-seek + AI prompts
- ✅ v9.11 timeline offset · v9.12 round-trip · v9.14 switchable AI vendors
- ⬜ **v9.13 next:** real-site subtitle fixture corpus
- ⬜ YouTube audio stream de-signing (would unlock no-subtitle transcription there)
- ⬜ More sites: Xigua / Tencent Video / Weibo Video / Vimeo
- ⬜ ASS / LRC export, bilingual export

---

## Contributing

1. Fork → branch → change
2. Run the test battery (see [Command Reference](#command-reference))
3. When bumping `@version`, update the README badge **and** CHANGELOG together (`check-docs.js` blocks drift)
4. After push, **always** run `node scripts/cdn-refresh.js` — jsDelivr caches `@main` for 12 hours, so without a purge users keep getting the old build

When you advertise a new capability, add an evidence assertion to `tests/test-claims.js`.

---

## License

MIT — see [LICENSE](LICENSE). Bilibili and YouTube are trademarks of their respective owners.

---

## ⭐ Star

If this script saved you from typing subtitles by hand once, **a star is the best thank-you** — and the only way more people find it.

**Author:** ReTri ([@huanweide](https://github.com/huanweide)) · MIT · © 2026

More tools by the same author: [bili-subtitle-extractor](https://github.com/huanweide/bili-subtitle-extractor) · [live-subtitle](https://github.com/huanweide/live-subtitle) · [zhihuishu-helper](https://github.com/huanweide/zhihuishu-helper) · [video-brief](https://github.com/huanweide/video-brief) · [all repos](https://github.com/huanweide?tab=repositories)
