# 📜 gemini.md — Project Constitution

**Project:** Scraper (Brand: Glaido)  
**Created:** 2026-02-18  
**Status:** 🔴 DRAFT — Schema Not Yet Defined

> ⚠️ This file is LAW. All scripts in `tools/` must conform to the schemas and rules defined here.
> Only update this file when: (1) a schema changes, (2) a rule is added, or (3) architecture is modified.

---

## 🎨 Brand Identity

| Property       | Value         |
|----------------|---------------|
| Brand Name     | Glaido        |
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

---

## 🗺️ Architecture Overview

```
Scraper/
├── gemini.md          # ← YOU ARE HERE: Project Constitution
├── .env               # API Keys/Secrets (never commit)
├── task_plan.md       # Phase checklist
├── findings.md        # Research & discoveries
├── progress.md        # Session log & error tracking
├── architecture/      # Layer 1: SOPs (Markdown how-tos)
├── tools/             # Layer 3: Python scripts (atomic engines)
└── .tmp/              # Temporary workbench (ephemeral)
```

---

## 📐 Data Schema

### Article Object (Unified across all sources)
```json
{
  "id": "string",           // SHA-256 hash of URL (dedup key)
  "title": "string",        // Article headline
  "summary": "string",      // First 300 chars of description
  "url": "string",          // Canonical link to article
  "source": "string",       // "bens_bites" | "rundown_ai" | "reddit_artificial" | "reddit_ml"
  "source_label": "string", // Display name: "Ben's Bites", "The Rundown AI", "Reddit"
  "published_at": "string", // ISO 8601 timestamp
  "author": "string",       // Author name or subreddit
  "score": "number|null",   // Reddit upvotes (null for newsletters)
  "thumbnail": "string|null",// Image URL if available
  "saved": "boolean"        // User-saved flag (persisted in localStorage)
}
```

### localStorage Schema
```json
{
  "glaido_articles": "Article[]",   // All fetched articles (last 24h)
  "glaido_saved": "string[]",       // Array of saved article IDs
  "glaido_last_fetch": "number"     // Unix timestamp of last fetch
}
```

### Fetch Response (from scraper)
```json
{
  "fetched_at": "string",   // ISO 8601
  "articles": "Article[]", // Filtered to last 24 hours only
  "sources": {
    "bens_bites": { "count": "number", "status": "ok|error" },
    "rundown_ai": { "count": "number", "status": "ok|error" },
    "reddit": { "count": "number", "status": "ok|error" }
  }
}
```

---

## 📏 Behavioral Rules

### Invariants (Always True)
1. All intermediate files go in `.tmp/` — never in root or `tools/`
2. All secrets go in `.env` — never hardcoded
3. All tools must be atomic and independently testable
4. SOPs in `architecture/` must be updated before code changes
5. `gemini.md` is the single source of truth — it overrides all other docs
6. Articles are filtered to **last 24 hours only** before display
7. Deduplication is enforced by article `id` (URL hash)
8. If a source fails to fetch, show a degraded-mode warning — do not crash

### Do-Not Rules
- Do NOT scrape pages behind login/paywall
- Do NOT store raw HTML — only structured Article objects
- Do NOT fetch more than once per 24 hours (check `glaido_last_fetch`)
- Do NOT hardcode API keys (none needed for Phase 1)

### Rate Limits & Constraints
- Reddit: max 60 requests/min unauthenticated; use `User-Agent: GlaidoDashboard/1.0`
- Beehiiv RSS: no documented rate limit; fetch once per 24h is safe
- 24-hour window: `published_at >= Date.now() - 86400000`

---

## 🔗 Integrations

| Service | Purpose | Status |
|---------|---------|--------|
| Ben's Bites (Beehiiv RSS) | Newsletter articles | ✅ No key needed |
| The Rundown AI (Beehiiv RSS) | Newsletter articles | ✅ No key needed |
| Reddit JSON API | r/artificial + r/MachineLearning posts | ✅ No key needed |
| Supabase | Persistent storage (Phase 2) | ⏳ Deferred |

---

## 🔧 Maintenance Log

| Date       | Change | Author |
|------------|--------|--------|
| 2026-02-18 | Initial constitution created | System Pilot |
