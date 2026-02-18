# 🔍 Findings — Research, Discoveries & Constraints

**Project:** Scraper  
**Created:** 2026-02-18

---

## 📁 Project Structure (Initial Discovery)

```
Scraper/
└── DesignGuidelines/
    ├── GlaidoLogo.png         # Brand logo
    ├── brandingGuidelines     # Color/font/spacing spec
    └── designInspo.png        # Visual reference
```

---

## 🎨 Branding Guidelines

| Property       | Value         |
|----------------|---------------|
| Primary Color  | `#BFF549`     |
| Accent Color   | `#BFF549`     |
| Background     | `#000000`     |
| Text Primary   | `#000000`     |
| Link Color     | `#99A1AF`     |
| Body Font      | Inter         |
| Heading Font   | Inter         |
| H1 Size        | 96px          |
| H2 Size        | 48px          |
| Body Size      | 24px          |
| Base Spacing   | 8px           |
| Border Radius  | 0px           |

**Brand Name:** Glaido (inferred from logo filename)

---

## 🔬 Research & External Resources

### Data Sources Confirmed

| Source | Method | URL / Endpoint |
|--------|--------|----------------|
| Ben's Bites | Beehiiv RSS | `https://bensbites.beehiiv.com/feed` (fallback: `https://bensbites.substack.com/feed`) |
| The Rundown AI | Beehiiv RSS | `https://rss.beehiiv.com/feeds/2R3C6Bt5wj.xml` |
| Reddit r/artificial | JSON API | `https://www.reddit.com/r/artificial/new.json?limit=25` |
| Reddit r/MachineLearning | JSON API | `https://www.reddit.com/r/MachineLearning/new.json?limit=25` |

### Key Technical Notes
- RSS feeds return XML; parse with Python `feedparser` or browser-side `DOMParser`
- Reddit JSON API: no auth needed for public subreddits; must set `User-Agent` header
- Reddit rate limit: ~60 requests/min unauthenticated
- All sources are public — no API keys required for Phase 1
- 24-hour filter: compare `published` timestamp to `Date.now() - 86400000`
- `localStorage` will be used for article saving (Supabase added in Phase 2)

---

## ⚠️ Constraints & Edge Cases

*To be populated as discovered during development.*

---

## 📌 Open Questions

1. What exactly is being scraped? (URLs, data types, frequency)
2. What external services are involved?
3. Where does the scraped data get stored/delivered?
4. Are there anti-scraping measures to handle (rate limits, CAPTCHAs)?
5. What are the behavioral/ethical rules for scraping?
