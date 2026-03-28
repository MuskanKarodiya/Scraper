# AINewz — AI News Dashboard

> **Live:** [scraper-wine-delta.vercel.app](https://scraper-wine-delta.vercel.app/)

A fully automated AI news aggregator. Pulls articles from **Ben's Bites**, **The Rundown AI**, **r/artificial**, and **r/MachineLearning** — no API keys, no database, no build step.

![Tech Stack](https://img.shields.io/badge/Frontend-Vanilla%20JS%20%2F%20HTML%20%2F%20CSS-black?style=flat-square&color=BFF549)
![Backend](https://img.shields.io/badge/Backend-Vercel%20Serverless-black?style=flat-square&color=5B8DEF)
![Cron](https://img.shields.io/badge/Cron-Modal%20Python-black?style=flat-square&color=FF6B35)
![Deployed](https://img.shields.io/badge/Deployed-Vercel-black?style=flat-square)

---

## What It Does

- Aggregates AI news from 4 sources every 24 hours
- Displays articles in a dark-mode card dashboard with per-source filtering, full-text search, and sort by newest / oldest / Reddit score
- Lets users save/bookmark articles (persisted in `localStorage`)
- Shows a detail modal per article with a direct link to the original
- Falls back gracefully if any source fails — degraded mode, never crashes

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | Vanilla HTML + CSS + JavaScript | No framework overhead; full control |
| Styling | Vanilla CSS | Custom Glaido design system, animations, responsive |
| Font | Inter (Google Fonts) | Clean, modern, weights 300–900 |
| Serverless API | Vercel Node.js Functions (`api/`) | Server-side CORS proxy for RSS and Reddit |
| Scheduled Scraper | Modal (Python) | 24h cron job; pre-scrapes and caches articles |
| Article Cache | Modal Dict | Persistent key-value store; survives between runs |
| Deployment | Vercel | Auto-deploy from GitHub; hosts static files + serverless fns |
| Article Persistence | Browser `localStorage` | No backend for saved articles |

---

## Architecture

```
User visits scraper-wine-delta.vercel.app
          │
          ▼
      app.js boots
          │
          ├─► localStorage cache valid? (< 24h old)
          │       └─ YES → load cached articles → render immediately
          │
          └─► Cache stale / Refresh pressed
                    │
                    ├─ 1st try: Modal pre-scraped endpoint
                    │       https://muskankarodiya06o--ainewz-...modal.run
                    │       (Python cron ran at 06:00 UTC, data already parsed)
                    │       ✅ Returns JSON instantly
                    │
                    └─ 2nd try: Live fetch via Vercel serverless functions
                              │
                              ├─ /api/rss?url=<beehiiv_feed>       ← Ben's Bites
                              ├─ /api/rss?url=<beehiiv_feed>       ← Rundown AI
                              ├─ /api/reddit?url=<subreddit>       ← r/artificial
                              └─ /api/reddit?url=<subreddit>       ← r/MachineLearning
                              │
                              (if Vercel fns fail, fallback to external CORS proxies)
                              │
                              ▼
                    Parse → Filter (72h) → Deduplicate → Store → Render
```

### Modal Cron (Server-side Scraper)

```
Every day at 06:00 UTC  →  modal_scraper.py :: scheduled_scrape()
    → fetch Ben's Bites RSS (Substack)
    → fetch Rundown AI RSS (Beehiiv)
    → fetch r/artificial RSS
    → fetch r/MachineLearning RSS
    → parse all feeds (namespace-agnostic XML parser)
    → deduplicate by MD5(url)[:12]
    → write JSON to modal.Dict["latest"]

GET /get_articles  →  reads modal.Dict["latest"]  →  returns JSON
```

---

## Project Structure

```
Scraper/
├── index.html              # Single-page app shell
├── styles.css              # Glaido design system — all CSS
├── app.js                  # All client-side logic (Storage, Fetcher, Parser, UI)
│
├── api/
│   ├── rss.js              # Vercel fn: GET /api/rss?url=   — RSS CORS proxy
│   └── reddit.js           # Vercel fn: GET /api/reddit?url= — Reddit proxy
│
├── modal_scraper.py        # Modal app: 24h cron + web endpoint
│
├── tools/
│   └── verify_feeds.py     # CLI: sanity-check all 4 source URLs
│
├── architecture/
│   └── sop_scraper.md      # Fetch strategy & edge case documentation
│
├── gemini.md               # Project constitution (schema, brand, rules)
└── .gitignore
```

---

## Data Sources

All sources are **public** — no API keys required.

| Source | Feed Type | Endpoint |
|--------|-----------|----------|
| Ben's Bites | Beehiiv RSS | `bensbites.beehiiv.com/feed` (Substack as fallback) |
| The Rundown AI | Beehiiv RSS | `rss.beehiiv.com/feeds/2R3C6Bt5wj.xml` |
| Reddit r/artificial | RSS / JSON API | `reddit.com/r/artificial/new.rss` |
| Reddit r/MachineLearning | RSS / JSON API | `reddit.com/r/MachineLearning/new.rss` |

### Unified Article Schema

Every article from every source is normalised before rendering:

```json
{
  "id":           "md5(url)[:12]",
  "title":        "Article headline",
  "summary":      "First 280 chars of description, HTML stripped",
  "url":          "https://...",
  "source":       "bens_bites | rundown_ai | reddit",
  "source_label": "Ben's Bites | The Rundown AI | Reddit",
  "published_at": "2026-02-18T06:00:00+00:00",
  "author":       "Author name  or  u/handle · r/subreddit",
  "score":        null,      // Reddit upvotes or null for newsletters
  "thumbnail":    "https://... or null",
  "saved":        false
}
```

---

## Services Used

### Vercel — Hosting + Serverless Functions

Vercel hosts the static frontend (`index.html`, `styles.css`, `app.js`) and auto-deploys on every `git push`. The `api/` folder is detected automatically as Node.js serverless functions.

**`/api/rss`** — fetches any RSS feed server-side (bypasses browser CORS). Follows up to 5 redirects, caches responses for 15 minutes via `Cache-Control: s-maxage=900`. No npm dependencies — uses Node.js built-in `https`/`http` modules only.

**`/api/reddit`** — fetches Reddit content server-side. Automatically converts JSON API URLs (`.json`) to RSS (`.rss`) because Reddit blocks datacenter IPs on its JSON endpoint. Falls back to JSON if RSS fails.

### Modal — Python Cron + Web Endpoint

[Modal](https://modal.com) is a serverless Python cloud platform. We use it for:

1. **`fetch_and_store()`** — Python function that fetches all 4 feeds using `urllib.request`, parses XML with `xml.etree.ElementTree` (no third-party libraries), and writes the result to a `modal.Dict` (persistent cloud key-value store).

2. **`scheduled_scrape()`** — decorated with `@app.function(schedule=modal.Cron("0 6 * * *"))`. Modal runs this every day at 06:00 UTC automatically. No external cron service needed.

3. **`get_articles()`** — a `@modal.web_endpoint` that reads from the `modal.Dict` and returns the cached articles as JSON with CORS headers. This is the URL the frontend hits first on every page load.

```
Public endpoint: https://muskankarodiya06o--ainewz-scraper-get-articles.modal.run
```

The App is named `ainewz-scraper` and runs in the `muskankarodiya06o` Modal workspace.

---

## Deployment

### Vercel

1. Repo pushed to GitHub (`MuskanKarodiya/Scraper`)
2. Imported into Vercel dashboard — zero config needed
3. Vercel auto-detects:
   - `index.html` at root → static site entry point
   - `api/rss.js` + `api/reddit.js` → Node.js serverless functions
4. Every `git push origin master` triggers automatic redeployment

No `package.json`, no build command, no environment variables.

### Modal

```bash
pip install modal
python -m modal setup        # browser auth → token saved to ~/.modal.toml
modal deploy modal_scraper.py

# Run scraper immediately (optional — cron handles it daily after this)
modal run modal_scraper.py
```

---

## Running Locally

```bash
git clone https://github.com/MuskanKarodiya/Scraper.git
cd Scraper

# Open the app — works directly in browser
open index.html
# or serve locally:
npx serve .
```

When running on `localhost`, the app skips the Vercel serverless functions (they're not running locally) and falls back to:
1. Modal endpoint (still works — it's a public URL)
2. `rss2json.com` API
3. External CORS proxies (`corsproxy.io`, `allorigins.win`, `codetabs.com`)

To verify all 4 feed URLs are reachable:
```bash
python tools/verify_feeds.py
```

---

## Design System

Brand: **Glaido** · Spec defined in `gemini.md`

| Token | Value |
|-------|-------|
| Background | `#000000` |
| Ben's Bites accent | `#BFF549` (lime green) |
| Rundown AI accent | `#5B8DEF` (blue) |
| Reddit accent | `#FF6B35` (orange) |
| Font | Inter |
| Border radius | `0px` (sharp corners) |

Cards use a CSS custom property `--source-color` for per-source colour highlights. Articles without a real thumbnail get a branded SVG placeholder generated as an inline `data:image/svg+xml` URI — so every card always shows an image.

---

## Key Technical Notes

**CORS strategy** — Browser can't call RSS feeds or Reddit directly (CORS blocked). On Vercel, the `/api/rss` and `/api/reddit` serverless functions act as server-side proxies. On localhost, the app falls back to public CORS proxy services.

**Reddit datacenter blocking** — Reddit's JSON API blocks server-side requests from datacenter IPs. Both the Vercel function and Modal scraper use the RSS endpoint (`/new.rss`) instead, which is more permissive. JSON API is a secondary fallback.

**Namespace-agnostic XML parsing** — RSS feeds from Beehiiv and Substack use namespace-prefixed tags (`media:thumbnail`, `dc:creator`, `content:encoded`). Both the JavaScript and Python parsers match tags by their **suffix** rather than full name, making them work with any namespace configuration.

**Deduplication** — Each article gets `id = MD5(url)[:12]` (Python) or a JS djb2 hash of the URL (browser). Duplicate IDs are dropped before rendering, preventing the same article from appearing twice if it shows up in multiple feeds.
