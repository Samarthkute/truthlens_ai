"""Optional: look up already-published fact-checks (Google Fact Check Tools API)."""
import os
import httpx

ENDPOINT = "https://factchecktools.googleapis.com/v1alpha1/claims:search"


def lookup(query: str, limit: int = 5) -> list[dict]:
    key = os.getenv("GOOGLE_FACTCHECK_API_KEY", "").strip()
    if not key or not query.strip():
        return []
    try:
        r = httpx.get(
            ENDPOINT,
            params={"query": query[:200], "key": key, "pageSize": limit},
            timeout=10,
        )
        r.raise_for_status()
    except Exception:
        return []  # fact-check lookup is best-effort
    out = []
    for claim in r.json().get("claims", []):
        for rev in claim.get("claimReview", [])[:1]:
            out.append(
                {
                    "claim": claim.get("text", ""),
                    "publisher": rev.get("publisher", {}).get("name", ""),
                    "rating": rev.get("textualRating", ""),
                    "title": rev.get("title", ""),
                    "url": rev.get("url", ""),
                }
            )
    return out[:limit]
