# Project map — Anyflow Lab
Updated: 2026-11-05 · by: Antigravity · verify with: npm --prefix app run build

## What it is
Anyflow Lab is an experimental lab fork of Anyflow — a multi-platform player and reader for anime, manga, and light novels (ranobe).
Supports Web (Vite), Windows (Electron), and iOS/Android (Capacitor). Main journeys include watching anime via AniLibria HLS/Kodik/WebTorrent, reading manga (MangaDex/Senkuro/local) with Gemini OCR translation, reading novels (RanobeHub/EPUB/FB2/TXT) with paper spreads and TTS, syncing history/collection via Supabase/Firebase.

## Stack & commands
- Stack: React 19, TypeScript, Vite, Tailwind CSS v4, Zustand 5 (persist), React Router 7, Lucide React, HLS.js, WebTorrent.
- Dev Web: `npm --prefix app run dev` (http://localhost:5173)
- Dev Electron: `npm --prefix app run electron:dev`
- Build: `npm --prefix app run build` (runs license generator, tsc, vite build)
- Typecheck: `npx --prefix app tsc -p tsconfig.app.json --noEmit`
- Testing UI: Runs in browser; guest mode works out of the box with mocked or direct open APIs (AniLibria, Shikimori, MangaDex).

## Structure (folder → responsibility)
- `app/src/pages/` — Route screens: Home (`Home.tsx`), Catalog (`Catalog.tsx`), Player (`Watch.tsx`), Settings (`Settings.tsx`), Manga (`manga/`), Ranobe (`ranobe/`), etc.
- `app/src/components/` — Shared UI: `Layout.tsx` (header, navigation, Logo), `Player.tsx`, `Music.tsx`, `Updates.tsx`, `Room.tsx`.
- `app/src/lib/` — Data & client layer: `palettes.ts` (themes), `store.ts` (Zustand persist state), `api.ts` (AniLibria), `shikimori.ts`, `sync.ts` (Supabase/Firebase), `platform.ts` (Electron/Capacitor bridges).
- `app/src/manga/` — Manga reader, Gemini image translation, local book reader (`BookReader.tsx`).
- `app/src/ranobe/` — Light novel online reader (`NovelReader.tsx`), sources.
- `app/src/read/` — Book page layout engine (`BookPages.tsx`, spreads, paper textures).
- `app/electron/` — Electron main process and preload scripts.
- `app/flavor.json` — Identity and branding config for this lab copy (DO NOT EDIT).

## Features → where they live
| feature / screen | route | main files | notes |
|---|---|---|---|
| Main shell & logo | * | `app/src/components/Layout.tsx` | Header, Logo component, sidebar nav, bottom tabs |
| Themes & Palettes | `/settings` | `app/src/lib/palettes.ts`, `app/src/index.css` | CSS variables on `:root[data-theme="..."]`, background patterns, art |
| Watch Anime | `/watch/:alias/:ordinal` | `app/src/pages/Watch.tsx`, `app/src/components/Player.tsx` | HLS player, quality switch, skip intro |
| Manga Reader | `/manga/read/...` | `app/src/manga/Reader.tsx`, `app/src/manga/BookReader.tsx` | Vertical & paged modes, Gemini translation |
| Ranobe Reader | `/ranobe/read/...` | `app/src/ranobe/NovelReader.tsx`, `app/src/read/` | Paper book rendering, Piper TTS |
| Settings | `/settings` | `app/src/pages/Settings.tsx` | Theme selector, cloud sync, scale, updates |

## Shared building blocks
- State: `useStore` in `app/src/lib/store.ts` (persisted to localStorage `aniplayer-store`), `useSync` in `app/src/lib/sync.ts`.
- Theming: `PALETTES` in `app/src/lib/palettes.ts`, `paletteById()`, `paletteVars()` in `app/src/lib/palettes.ts`.
- Formatters & helpers: `cn()` in `app/src/lib/format.ts`.
- Icons: `lucide-react`.

## Design system
- Dark UI with CSS custom properties: `--color-bg`, `--color-card`, `--color-accent`, `--color-accent-2`, `--color-pink`, `--color-glow`, `--color-grad`.
- Glassmorphism: `.glass` blur filter, rounded cards (`rounded-2xl` / `rounded-3xl`), subtle border lines (`var(--color-line)`).
- Fonts: `Manrope Variable` across the whole app.
- Unique themes apply custom artwork behind the UI (`.theme-art`), ambient patterns (`--theme-pattern`), panel borders and typography tweaks (`.theme-panel`, `[data-nav][aria-current="page"]`).

## Data & integrations
- Public APIs: AniLibria (`api.ts`), Shikimori (`shikimori.ts`), MangaDex, RanobeHub.
- Auth & Sync: Firebase Auth + Supabase database (`sync.ts`).
- Desktop: Electron IPC (`window.aniplayer`).

## Conventions
- UI strings are in Russian; code and comments in English.
- Safe mutations: do not break stored schemas or rename localStorage keys.
- Do not reformat entire files. Keep diffs focused and clean.

## Do not touch / gotchas
- `app/flavor.json` — Lab identity file (MUST NOT BE CHANGED).
- `D:\Projects\AniPlayer` and git remote `upstream` — Upstream repo, push disabled, do not touch.
- `lab-tools/` — Lab synchronization tools.
- `app/src/generated/licenses.json` — Generated at build time.
