# TruthLens AI — Full-Stack

Frontend (HTML/CSS/JS) + FastAPI backend that verifies text, news links, images and
**social posts / Reels** using Claude (optionally with live web search + Google Fact Check).

```
TruthLens_AI/
├── frontend/            index.html, style.css, app.js, config.js (backend URL), vercel.json
└── backend/
    ├── main.py          API routes (+ serves the frontend)
    ├── services/
    │   ├── llm.py       Claude calls, verdict JSON, chat
    │   ├── extractor.py article scraping, Reel/post caption + transcript extraction
    │   └── factcheck.py Google Fact Check Tools lookup (optional)
    ├── requirements.txt
    └── .env.example
(+ render.yaml at the root)
```

## Run locally
Requires Python 3.10+ (3.11/3.12 recommended).
```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # Windows: copy .env.example .env   -> then set ANTHROPIC_API_KEY
uvicorn main:app --reload --port 8000
```
Open **http://localhost:8000** (frontend + API on one server). Check http://localhost:8000/api/health -> `"has_key": true`.
Using VS Code Live Server (port 5500) also works: `app.js` auto-targets `http://localhost:8000`.

## API
| Method | Path | Body |
|---|---|---|
| POST | `/api/verify/text` | `{text, lang}` |
| POST | `/api/verify/link` | `{url, lang}` |
| POST | `/api/verify/social` | `{url, caption?, lang}` |
| POST | `/api/verify/image` | multipart: `file`, `lang` |
| POST | `/api/chat` | `{message, history}` |
| GET | `/api/health` | — |

All verify endpoints return: `verdict`, `confidence`, `summary`, `claims[]`, `red_flags[]`,
`sources[]`, `advice[]` (+ `extracted{}` for links/social posts).

## Reels: what works and what doesn't
- **YouTube / Shorts**: caption + auto-transcript — works well.
- **Instagram / Facebook / TikTok / X**: caption via `yt-dlp` for public posts. These platforms
  often block scrapers; if extraction fails the UI asks the user to paste the caption/spoken text.
  For login-walled posts you can export a `cookies.txt` and set `YTDLP_COOKIES_FILE`
  (use a throwaway account; respect each platform's terms).
- **Speech-to-text** for videos with no captions: `pip install faster-whisper`, set `ENABLE_WHISPER=true`.
- The AI sees **text only** (caption/transcript), not video frames, so edited or re-used footage can't be detected.

## Deploy: backend on Render, frontend on Vercel
**Why split?** The API makes slow calls (Claude + web search = 15-60 s) and runs yt-dlp. Vercel serverless
functions are short-lived and size-limited; Render runs it as a normal long-lived server.

1. Push this folder to GitHub (`.env` is git-ignored).
2. **Render** -> New + -> Blueprint -> select the repo (uses `render.yaml`). Set `ANTHROPIC_API_KEY`
   (and optionally `GOOGLE_FACTCHECK_API_KEY`). Leave `CORS_ORIGINS` for step 4. Deploy; note the URL,
   e.g. `https://truthlens-api.onrender.com`; `/api/health` should return JSON.
   (Manual alternative: Web Service, Root Directory `backend`, Build `pip install -r requirements.txt`,
   Start `uvicorn main:app --host 0.0.0.0 --port $PORT`.)
3. Edit `frontend/config.js`: `window.TRUTHLENS_API_BASE = "https://truthlens-api.onrender.com";` and commit/push.
4. **Vercel** -> Add New Project -> same repo -> **Root Directory = `frontend`**, Framework Preset "Other",
   no build command. Deploy; note the URL, e.g. `https://truthlens-ai.vercel.app`.
5. Back on Render -> Environment: `CORS_ORIGINS=https://truthlens-ai.vercel.app` (no trailing slash) -> save (it redeploys).

Notes: Render's free tier sleeps after ~15 min idle (first request takes ~50 s; the page pings `/api/health`
on load to wake it). YouTube blocks transcript requests from many cloud IPs, so on Render the transcript
may be missing and users get the "paste the caption" prompt. Instagram/Facebook usually need cookies.

## Before you go public
- Built-in rate limit: `RATE_LIMIT_PER_MIN` (default 10 POSTs/IP/min). Also set a monthly spend cap in the Anthropic Console.
- Replace the demo localStorage login with real auth.
- Never commit `.env`.
