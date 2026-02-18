"""
tools/verify_feeds.py
─────────────────────
Phase 2 — Link Verification
Hits all 4 feed endpoints and reports status + article count.
Run: python tools/verify_feeds.py
"""

import sys
import json
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone, timedelta
from xml.etree import ElementTree as ET

CUTOFF = datetime.now(timezone.utc) - timedelta(hours=24)

SOURCES = [
    {
        "name": "Ben's Bites (Beehiiv RSS)",
        "url": "https://bensbites.beehiiv.com/feed",
        "type": "rss",
    },
    {
        "name": "The Rundown AI (Beehiiv RSS)",
        "url": "https://rss.beehiiv.com/feeds/2R3C6Bt5wj.xml",
        "type": "rss",
    },
    {
        "name": "Reddit r/artificial",
        "url": "https://www.reddit.com/r/artificial/new.json?limit=25",
        "type": "reddit",
    },
    {
        "name": "Reddit r/MachineLearning",
        "url": "https://www.reddit.com/r/MachineLearning/new.json?limit=25",
        "type": "reddit",
    },
]

HEADERS = {
    "User-Agent": "GlaidoDashboard/1.0 (feed verifier)",
    "Accept": "application/json, application/xml, text/xml, */*",
}


def fetch(url, timeout=12):
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace"), resp.status
    except urllib.error.HTTPError as e:
        return None, e.code
    except Exception as e:
        return None, str(e)


def count_rss_items(xml_text):
    try:
        root = ET.fromstring(xml_text)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        items = root.findall(".//item") or root.findall(".//atom:entry", ns)
        recent = 0
        for item in items:
            pub = (
                item.findtext("pubDate")
                or item.findtext("{http://www.w3.org/2005/Atom}published")
                or item.findtext("{http://www.w3.org/2005/Atom}updated")
            )
            if pub:
                try:
                    from email.utils import parsedate_to_datetime
                    dt = parsedate_to_datetime(pub)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    if dt >= CUTOFF:
                        recent += 1
                except Exception:
                    recent += 1  # count if can't parse date
        return len(items), recent
    except ET.ParseError as e:
        return 0, 0


def count_reddit_posts(json_text):
    try:
        data = json.loads(json_text)
        posts = data.get("data", {}).get("children", [])
        recent = sum(
            1 for p in posts
            if p["data"].get("created_utc", 0) >= CUTOFF.timestamp()
        )
        return len(posts), recent
    except Exception:
        return 0, 0


def main():
    print("\n" + "═" * 56)
    print("  GLAIDO — Feed Verification Report")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  |  24h cutoff: {CUTOFF.strftime('%H:%M UTC')}")
    print("═" * 56)

    all_ok = True
    for src in SOURCES:
        print(f"\n▶  {src['name']}")
        print(f"   URL: {src['url']}")

        t0 = time.time()
        body, status = fetch(src["url"])
        elapsed = time.time() - t0

        if body is None:
            print(f"   ❌ FAILED  (status={status}, {elapsed:.1f}s)")
            all_ok = False
            continue

        if src["type"] == "rss":
            total, recent = count_rss_items(body)
        else:
            total, recent = count_reddit_posts(body)

        icon = "✅" if total > 0 else "⚠️ "
        print(f"   {icon} OK  (HTTP {status}, {elapsed:.1f}s)")
        print(f"   📰 {total} total items  |  🕐 {recent} in last 24h")

    print("\n" + "═" * 56)
    if all_ok:
        print("  ✅ All feeds responding. Safe to build dashboard.")
    else:
        print("  ⚠️  Some feeds failed. Check URLs or network.")
    print("═" * 56 + "\n")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
