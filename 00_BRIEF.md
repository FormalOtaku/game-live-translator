# 00_BRIEF

## Project
- Name: Game Live Translator
- Type: desktop app with local backend
- Mode: product
- Path: /home/murasaki01/Projects/Game_Live_Translator
- Initialized At: 2026-05-27T11:43:37.247Z

## Product Intent
- Problem: Japanese-only game streams are difficult for English-speaking viewers to follow.
- Target users: Windows + OBS streamers playing Japanese-only retro games, JRPGs, ADV, visual novels, indie, or doujin games for international audiences.
- Success metric: first-time setup to visible OBS English subtitle from a synthetic Japanese test scene in under 5 minutes.
- Quality target: production-grade v1 for the selected scope, not MVP/prototype unless explicitly requested.

## Scope
- In scope: Windows 10/11, OBS Browser Source, Japanese OCR, Japanese-to-English translation, ROI selection, profile persistence, overlay theming, glossary, diagnostics, privacy-first defaults.
- Out of scope: game modification, file/memory parsing, code injection, DRM bypass, translated script distribution, guaranteed vertical OCR, full offline translation, production macOS/Linux packaging.
- Scope strategy: reduce breadth before reducing reliability, UX states, tests, accessibility, privacy, or operability.

## Constraints
- Tech constraints: Electron + React + TypeScript frontend, Python 3.11 FastAPI sidecar, SQLite, OS keychain/keyring, OpenCV/OCR adapter, translation provider adapter, localhost overlay.
- Security/privacy constraints: server binds only `127.0.0.1`; API keys are write-only and stored only in OS secure storage; no OCR images/full text/translation full text persisted by default; overlay text is escaped.
- Delivery constraints: use Maestro-managed slices; specs before implementation; passing `npm test`, build, lint, and Claude sidecar review evidence before marking a slice done.

## Definition of Done
- [ ] Functional behavior validated for the selected slice.
- [ ] Specs/API/UI contracts updated before implementation when behavior changes.
- [ ] Tests pass (`npm test`).
- [ ] Build passes (`npm run build`).
- [ ] Lint passes (`npm run lint`).
- [ ] Claude sidecar review evidence imported through Maestro.
- [ ] TASKS.md, STATE.md, and structured Maestro state are synchronized.
