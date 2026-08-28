# LearnForge

> AI-powered sticky-card web learning tool — canvas knowledge management + spaced-repetition word learning + timeline visualization + AI assistance + plugin ecosystem.

[简体中文](./README-ZHCN.md)

## Overview

**LearnForge** (`learnforge-web`) is an AI-enabled web learning tool reworked from a Python CLI data-processing system (legacy `src/` kept as a data-pack import utility). It combines a free-form knowledge canvas with a state-machine-driven word-learning engine, a history timeline page, and integrated AI capabilities.

### Core Features

- **Knowledge Canvas** — Free-form sticky-card canvas (React Flow) with floating tool/tag panel, project-memory drawer, KaTeX math rendering, and multi-color text highlights.
- **Word Learning** — Spaced-repetition engine (SM-2 variant) with 5-factor recommendation scoring, 4 quiz formats, and a front-end state machine.
- **Timeline** — History event visualization (`/timeline`): point/period events, BC years, AI natural-language batch parsing, and lane/color separation for overlapping events.
- **AI Assistance** — Card generation/expansion, math solving, card-specific Q&A, and AI-distilled review entries via Vercel AI SDK v3 (multi-provider, streaming).
- **Plugin / Skill System** — Declarative manifest + permission scopes let external AI agents operate the canvas via OpenAI function-calling protocol.
- **LAN Access** — On-demand local network mode for mobile collaboration, with Host-spoofing token-theft prevention.
- **Data Safety** — Optimistic-lock revision protocol, snapshot restore, change log, and a SyncAdapter abstraction for future sync.
- **Data Import** — Compatible with the legacy `pack.json + data/*.json` format.

### System Architecture

```
LearnForge (Web app)
    ├── Canvas layer (React Flow)   — card CRUD / edges / layout persistence
    ├── Learning layer (state machine) — recommender / feature engine / SM-2
    ├── Timeline layer              — Timeline/TimelineEvent models / view algorithms / AI parsing
    ├── AI layer (AI SDK v3)        — multi-provider / streaming / function-calling
    ├── Plugin layer (harness)      — manifest registry / permission checks / audit log
    └── Data layer (Prisma + SQLite) — cards / learning profiles / snapshots / change log
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) + React 18 + TypeScript |
| Styling | Tailwind CSS 3 (in-house lightweight UI library) |
| Database | Prisma 5 + SQLite (PostgreSQL-ready) |
| Canvas | React Flow + KaTeX (lazy-loaded) |
| Rich Text | Tiptap (with custom highlight mark extension) |
| AI | Vercel AI SDK v3 (multi-provider, streaming) |
| Validation | Zod |
| State | Zustand + React Query + localStorage |
| Testing | Vitest 4 + @testing-library/react + jsdom |

## Quick Start

### Prerequisites

- Node.js >= 18.17 (20 LTS recommended)
- npm >= 9

### One-Click Setup

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

**macOS / Linux (Bash):**
```bash
chmod +x scripts/setup.sh && ./scripts/setup.sh
```

The setup script checks dependencies, generates `.env.local` from `.env.example`, runs `prisma generate` + `db push`, and starts the dev server.

### Manual Setup

```bash
npm install
cp .env.example .env.local   # edit values as needed
npx prisma generate
npx prisma db push
npm run dev                  # http://localhost:3000
```

### Start Modes

```bat
:: Default (loopback only, no LAN access)
start-dev.bat

:: LAN access mode (binds 0.0.0.0, disables auto-token endpoint)
start-dev-lan.bat

:: Stop
stop-dev.bat
```

## Project Structure

```
app/                    # Next.js App Router
├── (main)/             # Pages: canvas / learn / timeline / qa / stats / settings / import / tools/codec
├── api/                # Route Handlers (cards / ai / learn / timelines / settings / plugins / canvas-* …)
components/
├── ui/                 # Base UI: Dialog / Tabs / Select / Badge / Button
├── cards/              # Canvas: card-canvas / free-card-node / card-dialog / rich-text-editor
├── learn/              # Learning: learn-session / question-renderer (state machine)
├── timeline/           # Timeline: timeline-view / timeline-selector / event-dialog / ai-input-bar
├── ai/                 # project-memory-panel / ai-review-bridge
├── settings/           # Settings sections (models / task-bindings / codec / plugins)
└── shared/             # main-nav / theme-toggle / toaster
lib/
├── ai/                 # Provider abstraction, resolver, prompts
├── learning/           # Feature engine / recommender / scheduler / auth
├── sync/               # SyncAdapter interface + local impl (optimistic lock / snapshots / change log)
├── services/           # Business layer (cards / timelines / project-memory)
├── timeline/           # Timeline view-scale algorithms (pure functions)
├── plugins/            # Manifest / scopes / permissions / builtin / service
├── editor/             # Editor extensions (highlight mark / sanitizer)
└── utils/              # cn / http-error (unified error responses)
prisma/                 # schema.prisma (SQLite)
test/                   # Vitest unit tests (mirrors lib/ structure)
datapacks/              # Source data packs
data/                   # Imported data + SQLite DB
scripts/                # setup.ps1 / setup.sh / seed / git-net / ai-tools-demo
src/                    # Legacy Python data-pack reader/processor (kept for import)
docs/                   # DEPLOYMENT.md / PLUGIN_DEV.md / examples / superpowers (legacy design docs)
```

## Feature Pages

| Route | Function |
|-------|----------|
| `/canvas` | Full-screen knowledge canvas + floating panels + project-memory drawer + CardDialog (integrated AI) |
| `/learn` | Spaced-repetition learning (quiz + recommendation + review, 4 formats) |
| `/timeline` | History event timeline (create/edit/AI parsing/overlapping-event lanes & colors) |
| `/qa` | Redirects to `/canvas` (AI Q&A merged into card dialog) |
| `/stats` | Learning statistics (5-year window) |
| `/settings` | AI model config / multi-key rotation pool / knowledge base / data management / codec / plugins |
| `/import` | Data import |
| `/tools/codec` | `.lfdata` file encoder/decoder |
| `/` | Redirects to `/canvas` |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint (next/core-web-vitals) |
| `npm run typecheck` | TypeScript type check (no emit) |
| `npm run test` | Run Vitest once |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:coverage` | Vitest with coverage |
| `npm run db:generate` | Prisma client generation |
| `npm run db:migrate` | Prisma migrate dev |
| `npm run db:push` | Prisma db push |
| `npm run db:seed` | Seed database |

## Documentation

| Document | Content |
|----------|---------|
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Deployment guide, env vars, FAQ, LAN access |
| [docs/PLUGIN_DEV.md](./docs/PLUGIN_DEV.md) | Plugin/skill development guide + manifest spec |
| [docs/examples/plugin-manifest.example.json](./docs/examples/plugin-manifest.example.json) | Example plugin manifest |

## Environment Variables

Key variables (see `.env.example` for full list):

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | SQLite file path (default `file:./data/learnforge.db`) |
| `NEXTAUTH_SECRET` | NextAuth secret (required) |
| `NEXTAUTH_URL` | App URL (default `http://localhost:3000`) |
| `AI_PROVIDER` / `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | Default AI provider config |
| `LOCAL_ACCESS_TOKEN` | Optional API access token (recommended for LAN/public) |
| `CRON_SECRET` | Bearer token for `/api/cron/optimize` |
| `LAN_ACCESS` | Runtime flag set by `start-dev-lan.bat` (do not set in .env) |

## Data Pack Format

Learning data is organized as data packs under `datapacks/`:

```
datapacks/your-pack-name/
├── pack.json        # Core config (information / structure / type_map)
└── data/            # Data files (JSON)
    ├── 1.json
    ├── 2.json
    └── ...
```

`pack.json` has three parts:
- **information**: pack metadata (name / description / uuid / type)
- **structure**: data structure mapping (entrance folder + key_map field mapping)
- **type_map**: part-of-speech mapping (standard POS → display variants)

Pack types: `words_pack`, `sentence_pack`, `compound_pack`.

## Quality Gates

Standards enforced before every feature merge:

```bash
npm run typecheck   # 0 errors
npm run lint        # 0 warnings
npm run test        # all green + coverage target (lib/ >= 80%)
npm run build       # production build passes
```

Current baseline (2026-08-28): typecheck 0 errors, lint 0 warnings, tests 188/188 passing (18 files), build passing.

## License

Private project.
