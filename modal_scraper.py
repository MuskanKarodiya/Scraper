"""
AINewz Modal Scraper
====================
Runs every 24 hours to fetch articles from:
  - Ben's Bites (RSS via Substack)
  - The Rundown AI (RSS by Beehiiv)
  - Reddit r/artificial (RSS)
  - Reddit r/MachineLearning (RSS)

Stores results in a Modal Dict and exposes a web endpoint
so the frontend can load pre-fetched articles instantly.

Deploy:  modal deploy modal_scraper.py
Run now: modal run modal_scraper.py::fetch_and_store
"""

import modal
import json
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
import re
from datetime import datetime, timezone, timedelta
from hashlib import md5

# ── App & persistent storage ─────────────────────────────────────────────────
app = modal.App("ainewz-scraper")

# Image with FastAPI for the web endpoint
web_image = modal.Image.debian_slim().pip_install("fastapi[standard]")

# Persistent dict to store the latest articles JSON
articles_store = modal.Dict.from_name("ainewz-articles", create_if_missing=True)

# ── Feed sources ──────────────────────────────────────────────────────────────
SOURCES = [
    {
        "key": "bens_bites",
        "label": "Ben's Bites",
        "type": "rss",
        "urls": [
            "https://bensbites.substack.com/feed",  # Ben's Bites Substack (do NOT add Rundown AI URLs here)
        ],
    },
    {
        "key": "rundown_ai",
        "label": "The Rundown AI",
        "type": "rss",
        "urls": [
            "https://rss.beehiiv.com/feeds/2R3C6Bt5wj.xml",  # Verified Rundown AI Beehiiv feed
            "https://www.therundown.ai/rss",
        ],
    },
    {
        "key": "reddit",
        "label": "Reddit",
        "type": "reddit_multi",  # Tries RSS first, then JSON API
        "urls": [
            "https://old.reddit.com/r/artificial/new.rss?limit=50",
            "https://old.reddit.com/r/MachineLearning/new.rss?limit=50",
            "https://www.reddit.com/r/artificial/new.rss?limit=50",
            "https://www.reddit.com/r/MachineLearning/new.rss?limit=50",
        ],
        "json_urls": [
            "https://old.reddit.com/r/artificial/new.json?limit=50",
            "https://old.reddit.com/r/MachineLearning/new.json?limit=50",
        ],
    },
]

ARTICLE_WINDOW_HOURS = 72  # 72h covers weekend publishing gaps (newsletters skip Sat/Sun)

# ── Helpers ───────────────────────────────────────────────────────────────────
def hash_url(url: str) -> str:
    return md5(url.encode()).hexdigest()[:12]


def fetch_url(url: str, timeout: int = 15, is_reddit: bool = False) -> str | None:
    """Fetch a URL with redirect following and appropriate User-Agent."""
    if is_reddit:
        # Reddit API guidelines require a descriptive user-agent
        user_agent = "Mozilla/5.0 (compatible; GlaidoDashboard/1.0; +https://scraper-wine-delta.vercel.app)"
        accept = "application/rss+xml, application/xml, application/json, text/xml, */*"
    else:
        user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        accept = "application/rss+xml, application/xml, text/xml, */*"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Accept": accept,
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"[fetch] Failed {url}: {e}")
        return None


def parse_reddit_json(json_text: str, source_key: str, source_label: str) -> list[dict]:
    """Parse Reddit's JSON API response into Article objects."""
    import json as _json
    articles = []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=ARTICLE_WINDOW_HOURS)
    try:
        data = _json.loads(json_text)
        children = data.get("data", {}).get("children", [])
    except Exception as e:
        print(f"[parse_reddit_json] Parse error: {e}")
        return []

    for child in children:
        post = child.get("data", {})
        title = post.get("title", "Untitled")
        url = post.get("url") or post.get("permalink", "#")
        if url.startswith("/"):
            url = "https://www.reddit.com" + url
        score = post.get("score", 0)
        author = post.get("author", "reddit")
        subreddit = post.get("subreddit", "")
        created_utc = post.get("created_utc", 0)
        pub_dt = datetime.fromtimestamp(created_utc, tz=timezone.utc)
        if pub_dt < cutoff:
            continue
        selftext = post.get("selftext", "") or ""
        clean_summary = selftext.strip()[:300] + "…" if len(selftext.strip()) > 300 else selftext.strip()
        if not clean_summary:
            clean_summary = f"r/{subreddit} — {score} upvotes"
        thumbnail = post.get("thumbnail", "")
        if thumbnail in ("self", "default", "nsfw", "spoiler", "", None):
            thumbnail = None
        articles.append({
            "id": hash_url(url),
            "title": title.strip(),
            "summary": clean_summary,
            "url": url,
            "source": source_key,
            "source_label": source_label,
            "published_at": pub_dt.isoformat(),
            "author": f"u/{author}",
            "score": score,
            "thumbnail": thumbnail,
            "saved": False,
        })
    return articles


def parse_rss(xml_text: str, source_key: str, source_label: str) -> list[dict]:
    """Robust RSS/Atom parser that ignores namespaces."""
    articles = []
    cutoff = datetime.now(timezone.utc) - timedelta(hours=ARTICLE_WINDOW_HOURS)

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        print(f"[parse] XML error: {e}")
        return []

    # Iterate over all items/entries regardless of namespace
    items = []
    for elem in root.iter():
        if elem.tag.endswith("item") or elem.tag.endswith("entry"):
            items.append(elem)

    for item in items:
        # Helper to find child text safely ignoring namespace
        def get_text(tag_suffix):
            for child in item:
                if child.tag.endswith(tag_suffix):
                    return child.text or ""
            return ""

        def get_attr(tag_suffix, attr_name):
            for child in item:
                if child.tag.endswith(tag_suffix):
                    return child.get(attr_name)
            return None

        title = get_text("title") or "Untitled"
        link = get_text("link") or get_attr("link", "href") or "#"
        pub_raw = get_text("pubDate") or get_text("published") or get_text("updated")
        desc = get_text("description") or get_text("summary")
        content = get_text("encoded") or get_text("content") or ""
        author = get_text("author") or get_text("creator") or source_label

        # Parse date
        try:
            from email.utils import parsedate_to_datetime
            pub_dt = parsedate_to_datetime(pub_raw)
            if pub_dt.tzinfo is None:
                pub_dt = pub_dt.replace(tzinfo=timezone.utc)
        except Exception:
            try:
                pub_dt = datetime.fromisoformat(pub_raw.replace("Z", "+00:00"))
            except Exception:
                pub_dt = datetime.now(timezone.utc)

        if pub_dt < cutoff:
            continue

        # Strip HTML from description
        clean_desc = re.sub(r"<[^>]+>", "", desc).strip()
        if len(clean_desc) > 300:
            clean_desc = clean_desc[:300] + "…"
        if not clean_desc and len(content) > 0:
             clean_content = re.sub(r"<[^>]+>", "", content).strip()
             clean_desc = clean_content[:300] + "…"

        # Image extraction logic
        thumbnail = None
        
        # 1. Check media:thumbnail / media:content
        for child in item:
            tag = child.tag.lower()
            if tag.endswith("thumbnail") or tag.endswith("content"):
                url = child.get("url")
                typ = child.get("type") or ""
                if url and (url.endswith(('.jpg', '.png', '.jpeg', '.webp')) or 'image' in typ):
                    thumbnail = url
                    break
        
        # 2. Check enclosure
        if not thumbnail:
            enc_url = get_attr("enclosure", "url")
            enc_type = get_attr("enclosure", "type")
            if enc_url and ('image' in (enc_type or "") or enc_url.endswith(('.jpg', '.png', '.jpeg'))):
                thumbnail = enc_url

        # 3. Regex on content/description
        if not thumbnail:
            full_html = (desc or "") + (content or "")
            img_match = re.search(r'<img[^>]+src="([^">]+)"', full_html)
            if img_match:
                thumbnail = img_match.group(1)

        articles.append({
            "id": hash_url(link),
            "title": title.strip(),
            "summary": clean_desc,
            "url": link,
            "source": source_key,
            "source_label": source_label,
            "published_at": pub_dt.isoformat(),
            "author": author.strip() or source_label,
            "score": None,
            "thumbnail": thumbnail,
            "saved": False,
        })

    return articles


# ── Core scrape function ──────────────────────────────────────────────────────
@app.function(
    timeout=120,
    retries=2,
)
def fetch_and_store():
    """Fetch all feeds and store results in Modal Dict."""
    all_articles = []
    errors = []

    for source in SOURCES:
        fetched = False
        is_reddit = source["type"] == "reddit_multi"

        # Try RSS/XML URLs first
        for url in source["urls"]:
            print(f"[scraper] Fetching {source['key']} from {url}")
            xml_text = fetch_url(url, is_reddit=is_reddit)
            if xml_text and len(xml_text) > 200:
                new_articles = parse_rss(xml_text, source["key"], source["label"])
                if new_articles:
                    print(f"[scraper] {source['key']}: {len(new_articles)} articles from RSS")
                    all_articles.extend(new_articles)
                    fetched = True
                    break
                else:
                    print(f"[scraper] {source['key']}: parsed 0 articles from {url}")
            else:
                print(f"[scraper] {source['key']}: empty/failed response from {url}")

        # For Reddit: if RSS failed, try JSON API
        if not fetched and is_reddit and source.get("json_urls"):
            print(f"[scraper] Reddit RSS failed — trying JSON API fallback")
            for json_url in source["json_urls"]:
                print(f"[scraper] Reddit JSON: {json_url}")
                json_text = fetch_url(json_url, is_reddit=True)
                if json_text and len(json_text) > 200:
                    new_articles = parse_reddit_json(json_text, source["key"], source["label"])
                    if new_articles:
                        print(f"[scraper] reddit: {len(new_articles)} articles from JSON API")
                        all_articles.extend(new_articles)
                        fetched = True
                        break
                    else:
                        print(f"[scraper] reddit JSON: 0 articles from {json_url}")

        if not fetched:
            errors.append(source["label"])
            print(f"[scraper] FAILED: {source['key']}")

    # Deduplicate by id
    seen = set()
    unique = []
    for a in all_articles:
        if a["id"] not in seen:
            seen.add(a["id"])
            unique.append(a)

    # Sort newest first
    unique.sort(key=lambda a: a["published_at"], reverse=True)

    payload = {
        "articles": unique,
        "errors": errors,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "count": len(unique),
    }

    articles_store["latest"] = json.dumps(payload)
    print(f"[scraper] Done. {len(unique)} articles stored. Errors: {errors}")
    return payload


# ── Web endpoint — serves cached articles as JSON ─────────────────────────────
@app.function(image=web_image)
@modal.web_endpoint(method="GET")
def get_articles():
    """Returns the latest cached articles as JSON."""
    from fastapi.responses import JSONResponse

    raw = articles_store.get("latest")
    if not raw:
        # No cache yet — run a fresh fetch
        payload = fetch_and_store.local()
    else:
        payload = json.loads(raw)

    return JSONResponse(
        content=payload,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=3600",
        },
    )


# ── Scheduled job — runs every 24 hours ───────────────────────────────────────
@app.function(
    schedule=modal.Cron("0 6 * * *"),  # 6:00 AM UTC daily
)
def scheduled_scrape():
    """Triggered by Modal's scheduler every 24 hours."""
    print("[scheduler] Starting scheduled scrape...")
    result = fetch_and_store.local()
    print(f"[scheduler] Complete. {result['count']} articles, errors: {result['errors']}")


# ── Local entrypoint for testing ──────────────────────────────────────────────
@app.local_entrypoint()
def main():
    print("Running scraper locally (using Modal cloud)...")
    result = fetch_and_store.remote()
    print(f"\n✅ Done! {result['count']} articles fetched.")
    if result["errors"]:
        print(f"⚠️  Failed sources: {', '.join(result['errors'])}")
    print("\nFirst 3 articles:")
    for a in result["articles"][:3]:
        print(f"  [{a['source']}] {a['title'][:70]}")
