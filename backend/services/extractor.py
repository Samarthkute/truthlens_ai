"""Turn a URL (article or social post/reel) into text the LLM can check."""
import ipaddress
import os
import re
import socket
import tempfile
from urllib.parse import urlparse, urljoin

import httpx
from bs4 import BeautifulSoup

MAX_CHARS = 15000
UA = "Mozilla/5.0 (compatible; TruthLensBot/1.0; +educational project)"


class ExtractionError(Exception):
    """Raised with a user-friendly message."""


# ---------- safety: never let a user make the server call internal addresses ----------
def assert_public_url(url: str) -> str:
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise ExtractionError("Please enter a complete link starting with http:// or https://")
    try:
        infos = socket.getaddrinfo(p.hostname, p.port or 443)
    except socket.gaierror:
        raise ExtractionError("That website address could not be found.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ExtractionError("That link points to a private address and cannot be opened.")
    return url


# ---------- news article ----------
def fetch_article(url: str) -> dict:
    assert_public_url(url)
    html, current = "", url
    with httpx.Client(timeout=15, headers={"User-Agent": UA}, follow_redirects=False) as c:
        for _ in range(4):  # follow redirects manually so each hop is checked
            r = c.get(current)
            if r.is_redirect and r.headers.get("location"):
                current = assert_public_url(urljoin(current, r.headers["location"]))
                continue
            if r.status_code >= 400:
                raise ExtractionError(f"The website refused the request (HTTP {r.status_code}). Paste the article text instead.")
            html = r.text[:2_000_000]
            break
    text = ""
    try:
        import trafilatura

        text = trafilatura.extract(html) or ""
    except Exception:
        pass
    soup = BeautifulSoup(html, "html.parser")
    title = (soup.title.string or "").strip() if soup.title and soup.title.string else ""
    if len(text) < 200:  # fallback
        for t in soup(["script", "style", "nav", "footer", "header", "aside"]):
            t.decompose()
        text = re.sub(r"\s+", " ", soup.get_text(" ")).strip()
    if len(text) < 80:
        raise ExtractionError("Couldn't read the article text from that page. Paste the text instead.")
    return {"platform": urlparse(url).hostname, "title": title, "text": text[:MAX_CHARS], "url": url}


# ---------- social posts / reels ----------
SOCIAL_HOSTS = {
    "instagram.com": "Instagram", "youtube.com": "YouTube", "youtu.be": "YouTube", "youtube-nocookie.com": "YouTube",
    "facebook.com": "Facebook", "fb.watch": "Facebook", "fb.com": "Facebook", "tiktok.com": "TikTok",
    "twitter.com": "X/Twitter", "x.com": "X/Twitter", "t.co": "X/Twitter",
}


def _platform(url: str) -> str:
    h = (urlparse(url).hostname or "").lower()
    for dom, name in SOCIAL_HOSTS.items():  # exact domain or subdomain only ("fox.com" is NOT "x.com")
        if h == dom or h.endswith("." + dom):
            return name
    return ""


def _youtube_id(url: str):
    m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/)([A-Za-z0-9_-]{11})", url)
    return m.group(1) if m else None


def _youtube_transcript(video_id: str) -> str:
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except Exception:
        return ""
    try:
        api = YouTubeTranscriptApi()
        try:
            fetched = api.fetch(video_id, languages=["en", "hi", "mr"])
        except Exception:  # no captions in those languages -> take whatever exists (incl. auto-generated)
            tl = next(iter(api.list(video_id)))
            fetched = tl.fetch()
        return " ".join(s.text for s in fetched)
    except AttributeError:  # youtube-transcript-api < 1.0
        try:
            parts = YouTubeTranscriptApi.get_transcript(video_id, languages=["en", "hi", "mr"])
            return " ".join(p["text"] for p in parts)
        except Exception:
            return ""
    except Exception:
        return ""  # blocked IP (common on cloud hosts), no captions, private video...


def _whisper_transcribe(url: str, duration) -> str:
    if os.getenv("ENABLE_WHISPER", "false").lower() != "true":
        return ""
    if duration and duration > 600:
        return ""  # keep it cheap: skip videos over 10 minutes
    try:
        import yt_dlp
        from faster_whisper import WhisperModel
    except Exception:
        return ""
    with tempfile.TemporaryDirectory() as tmp:
        opts = {"quiet": True, "noplaylist": True, "format": "bestaudio/best",
                "outtmpl": os.path.join(tmp, "audio.%(ext)s"), "socket_timeout": 15}
        if os.getenv("YTDLP_COOKIES_FILE"):
            opts["cookiefile"] = os.getenv("YTDLP_COOKIES_FILE")
        try:
            with yt_dlp.YoutubeDL(opts) as y:
                y.download([url])
            path = os.path.join(tmp, os.listdir(tmp)[0])
            model = WhisperModel(os.getenv("WHISPER_MODEL", "base"), compute_type="int8")
            segments, _ = model.transcribe(path)
            return " ".join(s.text.strip() for s in segments)
        except Exception:
            return ""


def extract_social(url: str, manual_text: str = "") -> dict:
    assert_public_url(url)
    platform = _platform(url)
    if not platform:  # not a known social site: treat it like an article page (never hand arbitrary URLs to yt-dlp)
        art = fetch_article(url)
        extra = f"\nText pasted by the user: {manual_text.strip()}" if manual_text.strip() else ""
        return {"platform": art["platform"], "title": art["title"], "uploader": "", "has_transcript": False,
                "text": (f"Title: {art['title']}\n{art['text']}{extra}")[:MAX_CHARS], "url": url}
    info: dict = {}
    try:
        import yt_dlp

        opts = {"quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True, "socket_timeout": 15}
        if os.getenv("YTDLP_COOKIES_FILE"):
            opts["cookiefile"] = os.getenv("YTDLP_COOKIES_FILE")
        with yt_dlp.YoutubeDL(opts) as y:
            info = y.extract_info(url, download=False) or {}
    except Exception:
        info = {}  # login-walled / private / unsupported: fall back to manual text

    caption = (info.get("description") or "").strip()
    title = (info.get("title") or "").strip()
    uploader = (info.get("uploader") or info.get("channel") or "").strip()
    upload_date = info.get("upload_date") or ""

    transcript = ""
    if platform == "YouTube":
        vid = _youtube_id(url)
        transcript = _youtube_transcript(vid) if vid else ""
    if not transcript and info:
        transcript = _whisper_transcribe(url, info.get("duration"))

    parts = []
    if uploader:
        parts.append(f"Posted by: {uploader}")
    if len(upload_date) == 8:
        parts.append(f"Upload date: {upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}")
    if title and title != caption:
        parts.append(f"Title: {title}")
    if caption:
        parts.append(f"Caption/description: {caption}")
    if transcript:
        parts.append(f"Spoken words (transcript): {transcript}")
    if manual_text.strip():
        parts.append(f"Text pasted by the user: {manual_text.strip()}")

    if len(caption) + len(transcript) + len(manual_text.strip()) < 15:
        raise ExtractionError(
            f"Couldn't read the caption or speech from this {platform} link automatically "
            "(private, login-protected, or no captions). Paste the caption or what is said in the "
            "video into the box below the link and try again."
        )
    return {
        "platform": platform,
        "title": title or caption[:80],
        "uploader": uploader,
        "text": "\n".join(parts)[:MAX_CHARS],
        "has_transcript": bool(transcript),
        "url": url,
    }
