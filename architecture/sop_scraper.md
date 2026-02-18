# SOP: Feed Scraper

**Layer 1 — Architecture**  
**Last Updated:** 2026-02-18

---

## Goal
Fetch articles from 4 sources, filter to last 24 hours, normalize into unified Article objects, and persist to `localStorage`.

## Sources & Endpoints

| Source | Type | URL |
|--------|------|-----|
| Ben's Bites | RSS (Beehiiv) | `https://bensbites.beehiiv.com/feed` |
| The Rundown AI | RSS (Beehiiv) | `https://rss.beehiiv.com/feeds/2R3C6Bt5wj.xml` |
| Reddit r/artificial | JSON API | `https://www.reddit.com/r/artificial/new.json?limit=50` |
| Reddit r/MachineLearning | JSON API | `https://www.reddit.com/r/MachineLearning/new.json?limit=50` |

## CORS Strategy
RSS feeds are fetched via `https://api.allorigins.win/get?url=<encoded>` to bypass browser CORS restrictions. Reddit JSON API is fetched directly (CORS-open endpoint).

## 24-Hour Filter
`published_at >= Date.now() - 86400000`

## Deduplication
Each article gets an ID = `hashUrl(link)`. Duplicate IDs are dropped before rendering.

## Cache Logic
- On load: check `glaido_last_fetch` in `localStorage`
- If `< 24h ago`: load from `glaido_articles` cache
- If `>= 24h ago`: re-fetch all sources, update cache

## Error Handling
- If a source fails: log warning, continue with other sources
- Show degraded-mode banner listing failed sources
- Never crash the entire dashboard for one source failure

## Edge Cases
- RSS `<link>` can be text content OR `href` attribute — check both
- Reddit `url` may be relative (starts with `/`) — prepend `https://reddit.com`
- Reddit `thumbnail` may be `"self"` or `"default"` — ignore non-http values
- Beehiiv RSS may return 0 items if no posts in last 24h — this is valid
