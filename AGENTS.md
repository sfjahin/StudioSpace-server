# AGENTS.md

Single-file Express 5 + MongoDB API for the StudioSpace app. Plain ESM JavaScript (`"type": "module"`), no build step, no linter, no typechecker, and **no test suite** (`npm test` is a placeholder that exits 1 — don't run it as verification).

## Commands

- `npm run dev` — start with `node --watch index.js` (auto-restart; Node 18+).
- `npm start` — start once.
- Verify a change by starting the server and exercising the endpoints with curl/HTTP; there is nothing else to run.

## Setup

- Requires `.env` at the repo root with `MONGODB_URI` (gitignored). `PORT` (default `8000`) and `MONGODB_DB` (default `studiospace`) are optional.
- `start()` runs at module load, so the process exits (code 1) if MongoDB is unreachable. Importing `index.js` therefore opens a DB connection and binds a port — don't import it from scripts/tests.
- The app uses the `studios` collection in the configured database.

## Architecture

- `index.js` is the entire app: Express setup, Mongo client, validation, and all routes. There are no routers, controllers, models, or middleware directories.
- Routes: `GET /` (health), `POST /add-studio`, `GET /studios`, `GET /studios/:id`.
- `toClient()` maps Mongo `_id` to a string `id`; API responses never use `_id`. `GET /studios` sorts newest `createdAt` first.
- Posts are validated by `validateStudio()` in the same file. On failure it returns `400 { message, fields }` with per-field messages; on success `201` with the created object. Keep this contract in sync with the frontend.
- Allowed `category` values are the hard-coded `CATEGORIES` set (`Photo Studio`, `Film Stage`, `Podcast Lounge`, `Music Suite`, `Workshop`, `Dance Studio`, `Art & Making`, `Other`). Adding a category means editing that set.
- CORS is fully open (`cors()`); JSON body parsing is enabled globally. Use `express.json()`-compatible bodies.

## Deployment

- `vercel.json` sends every path to `index.js` as a single `@vercel/node` function. Don't add a separate server entrypoint or assume Vercel static routing.
- Vercel project name is `studiospace` (see `.vercel/project.json`); `MONGODB_URI` must be configured in the Vercel environment as well.
