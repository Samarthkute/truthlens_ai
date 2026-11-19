"""TruthLens AI backend. Run:  uvicorn main:app --reload --port 8000"""
import os
import time
from collections import defaultdict, deque
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from services import extractor, factcheck, llm

app = FastAPI(title="TruthLens AI")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip().rstrip("/") for o in os.getenv("CORS_ORIGINS", "http://localhost:8000").split(",") if o.strip()],
    # optional: e.g. https://.*\.vercel\.app  to also allow Vercel preview URLs
    allow_origin_regex=os.getenv("CORS_ORIGIN_REGEX") or None,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- tiny per-IP rate limiter (protects your Anthropic bill; in-memory, resets on restart) ---
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_MIN", "10"))  # 0 = off
_hits: dict = defaultdict(deque)


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    if RATE_LIMIT and request.method == "POST" and request.url.path.startswith("/api/"):
        fwd = request.headers.get("x-forwarded-for", "")
        ip = fwd.split(",")[0].strip() or (request.client.host if request.client else "?")
        now, q = time.time(), _hits[ip]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= RATE_LIMIT:
            return JSONResponse({"detail": "Too many requests - please wait a minute and try again."}, status_code=429,
                                headers={"Access-Control-Allow-Origin": request.headers.get("origin", "*")})
        q.append(now)
        if len(_hits) > 5000:  # keep memory bounded
            for k in [k for k, v in _hits.items() if not v or now - v[-1] > 60]:
                _hits.pop(k, None)
    return await call_next(request)


class TextReq(BaseModel):
    text: str = Field(min_length=15, max_length=20000)
    lang: str = "en"


class LinkReq(BaseModel):
    url: str = Field(max_length=2000)
    lang: str = "en"


class SocialReq(BaseModel):
    url: str = Field(max_length=2000)
    caption: str = Field(default="", max_length=10000)
    lang: str = "en"


class ChatReq(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[dict] = []


def _run(**kw):
    try:
        return llm.verify(**kw)
    except RuntimeError as e:  # missing API key
        raise HTTPException(500, str(e))
    except Exception as e:
        raise HTTPException(502, f"The AI service failed: {type(e).__name__}. Please try again.")


@app.get("/api/health")
def health():
    return {"ok": True, "model": llm.MODEL, "has_key": bool(os.getenv("GEMINI_API_KEY")),
            "web_search": os.getenv("USE_WEB_SEARCH", "true"), "factcheck_api": bool(os.getenv("GOOGLE_FACTCHECK_API_KEY"))}


@app.post("/api/verify/text")
def verify_text(req: TextReq):
    return _run(text=req.text, kind="text", lang=req.lang, fact_checks=factcheck.lookup(req.text[:200]))


@app.post("/api/verify/link")
def verify_link(req: LinkReq):
    try:
        art = extractor.fetch_article(req.url)
    except extractor.ExtractionError as e:
        raise HTTPException(422, str(e))
    except Exception:
        raise HTTPException(422, "Couldn't open that link. Check it and try again, or paste the article text.")
    text = f"Source: {art['platform']}\nTitle: {art['title']}\n\n{art['text']}"
    result = _run(text=text, kind="link", lang=req.lang, fact_checks=factcheck.lookup(art["title"] or art["text"][:200]))
    result["extracted"] = {"platform": art["platform"], "title": art["title"], "preview": art["text"][:500]}
    return result


@app.post("/api/verify/social")
def verify_social(req: SocialReq):
    try:
        post = extractor.extract_social(req.url, req.caption)
    except extractor.ExtractionError as e:
        raise HTTPException(422, str(e))
    except Exception:
        raise HTTPException(422, "Couldn't read that post. Paste the caption or spoken text and try again.")
    result = _run(text=post["text"], kind="social", lang=req.lang, fact_checks=factcheck.lookup(post["text"][:200]))
    result["extracted"] = {"platform": post["platform"], "title": post["title"], "uploader": post["uploader"],
                           "has_transcript": post["has_transcript"], "preview": post["text"][:600]}
    return result


@app.post("/api/verify/image")
async def verify_image(file: UploadFile = File(...), lang: str = Form("en")):
    if file.content_type not in ("image/png", "image/jpeg", "image/jpg", "image/webp"):
        raise HTTPException(415, "Please upload a JPG, PNG or WEBP image.")
    data = await file.read()
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "Image is too large (max 5 MB for analysis).")
    from starlette.concurrency import run_in_threadpool

    return await run_in_threadpool(_run, text="(see attached image)", kind="image", lang=lang, image=(data, "image/jpeg" if file.content_type == "image/jpg" else file.content_type))


@app.post("/api/chat")
def chat(req: ChatReq):
    try:
        return {"reply": llm.chat(req.message, req.history)}
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    except Exception:
        raise HTTPException(502, "The assistant is unavailable right now.")


# Serve the frontend from the same server (local use) -> open http://localhost:8000
# Skipped automatically when the frontend folder isn't deployed alongside (e.g. API-only on Render).
FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
else:

    @app.get("/")
    def root():
        return {"service": "TruthLens AI API", "health": "/api/health"}
