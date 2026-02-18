/**
 * ═══════════════════════════════════════════════════════════
 *  AINewz DASHBOARD — app.js
 *  Fetcher · Parser · Storage · UI
 * ═══════════════════════════════════════════════════════════
 */

'use strict';

/* ─── Constants ─────────────────────────────────────────── */
const STORAGE_KEYS = {
    articles: 'ainewz_articles',
    saved: 'ainewz_saved',
    lastFetch: 'ainewz_last_fetch',
};
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h cache freshness
const ARTICLE_WINDOW = 72 * 60 * 60 * 1000; // show articles from last 72h

// Our own Vercel serverless API — primary strategy (no CORS, server-side)
// Falls back to external proxies when running on localhost dev
const IS_DEPLOYED = location.hostname !== 'localhost' && location.hostname !== '127.0.0.1';
const OWN_RSS_API = (url) => `/api/rss?url=${encodeURIComponent(url)}`;
const OWN_REDDIT_API = (url) => `/api/reddit?url=${encodeURIComponent(url)}`;

// External CORS proxies — fallback for localhost or if own API fails
const CORS_PROXIES = [
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

// rss2json API — fallback RSS parser
const RSS2JSON = (url) =>
    `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}&count=50&order_by=pubDate&order_dir=desc`;

const SOURCES = {
    bens_bites: {
        key: 'bens_bites',
        label: 'Ben\'s Bites',
        color: '#BFF549',
        badge: 'badge-bens',
        // Try beehiiv first, fallback to substack
        urls: [
            'https://bensbites.beehiiv.com/feed',
            'https://bensbites.substack.com/feed',
        ],
        type: 'rss',
    },
    rundown_ai: {
        key: 'rundown_ai',
        label: 'The Rundown AI',
        color: '#5B8DEF',
        badge: 'badge-rundown',
        urls: ['https://rss.beehiiv.com/feeds/2R3C6Bt5wj.xml'],
        type: 'rss',
    },
    reddit_artificial: {
        key: 'reddit_artificial',
        label: 'Reddit',
        color: '#FF6B35',
        badge: 'badge-reddit',
        urls: ['https://www.reddit.com/r/artificial/new.json?limit=50'],
        type: 'reddit',
        sub: 'r/artificial',
    },
    reddit_ml: {
        key: 'reddit_ml',
        label: 'Reddit',
        color: '#FF6B35',
        badge: 'badge-reddit',
        urls: ['https://www.reddit.com/r/MachineLearning/new.json?limit=50'],
        type: 'reddit',
        sub: 'r/MachineLearning',
    },
};

/* ─── State ─────────────────────────────────────────────── */
let state = {
    allArticles: [],
    savedIds: new Set(),
    currentFilter: 'all',
    searchQuery: '',
    sortOrder: 'newest',
    activeModal: null,
};

/* ═══════════════════════════════════════════════════════════
   STORAGE MODULE
═══════════════════════════════════════════════════════════ */
const Storage = {
    get(key) {
        try { return JSON.parse(localStorage.getItem(key)); }
        catch { return null; }
    },
    set(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); }
        catch (e) { console.warn('Storage write failed:', e); }
    },
    getSavedIds() {
        return new Set(this.get(STORAGE_KEYS.saved) || []);
    },
    saveSavedIds(set) {
        this.set(STORAGE_KEYS.saved, [...set]);
    },
    getArticles() {
        return this.get(STORAGE_KEYS.articles) || [];
    },
    setArticles(articles) {
        this.set(STORAGE_KEYS.articles, articles);
    },
    getLastFetch() {
        return this.get(STORAGE_KEYS.lastFetch) || 0;
    },
    setLastFetch(ts) {
        this.set(STORAGE_KEYS.lastFetch, ts);
    },
    isCacheValid() {
        return (Date.now() - this.getLastFetch()) < CACHE_TTL;
    },
};

/* ═══════════════════════════════════════════════════════════
   FETCHER MODULE
═══════════════════════════════════════════════════════════ */
const Fetcher = {

    // Generic fetch with timeout
    async _fetch(url, opts = {}, timeoutMs = 12000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...opts, signal: controller.signal });
            clearTimeout(timer);
            return res;
        } catch (e) {
            clearTimeout(timer);
            throw e;
        }
    },

    // Strategy 1: rss2json.com — parses RSS server-side, returns JSON
    async fetchViaRss2Json(feedUrl) {
        try {
            const apiUrl = RSS2JSON(feedUrl);
            console.log('[rss2json] Trying:', feedUrl);
            const res = await this._fetch(apiUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.status !== 'ok') throw new Error(`rss2json error: ${data.message}`);
            console.log('[rss2json] OK, items:', data.items?.length);
            return { type: 'rss2json', data };
        } catch (e) {
            console.warn('[rss2json] Failed:', e.message);
            return null;
        }
    },

    // Strategy 2: CORS proxy → raw XML
    async fetchViaProxy(feedUrl) {
        for (const makeProxy of CORS_PROXIES) {
            const proxyUrl = makeProxy(feedUrl);
            try {
                console.log('[proxy] Trying:', proxyUrl.slice(0, 80));
                const res = await this._fetch(proxyUrl);
                if (!res.ok) { console.warn('[proxy] HTTP', res.status); continue; }
                const text = await res.text();

                // allorigins wraps in JSON {contents: "..."}
                let xmlText = text;
                try {
                    const json = JSON.parse(text);
                    if (json.contents) xmlText = json.contents;
                } catch { /* raw XML, use as-is */ }

                if (!xmlText || xmlText.length < 100) { console.warn('[proxy] Empty body'); continue; }

                const parser = new DOMParser();
                const doc = parser.parseFromString(xmlText, 'text/xml');
                if (doc.querySelector('parsererror')) { console.warn('[proxy] XML parse error'); continue; }

                console.log('[proxy] OK, items:', doc.querySelectorAll('item, entry').length);
                return { type: 'xml', doc };
            } catch (e) {
                console.warn('[proxy] Error:', e.message);
            }
        }
        return null;
    },

    // Main RSS fetcher — tries own /api/rss first (deployed), then rss2json, then proxy
    async fetchRSS(source) {
        for (const feedUrl of source.urls) {
            // Strategy 0: Own Vercel serverless API (deployed only)
            if (IS_DEPLOYED) {
                try {
                    const apiUrl = OWN_RSS_API(feedUrl);
                    console.log('[own-api/rss] Trying:', feedUrl);
                    const res = await this._fetch(apiUrl);
                    if (res.ok) {
                        const xmlText = await res.text();
                        if (xmlText && xmlText.length > 100) {
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(xmlText, 'text/xml');
                            if (!doc.querySelector('parsererror')) {
                                console.log('[own-api/rss] OK, items:', doc.querySelectorAll('item, entry').length);
                                return { method: 'proxy', result: { type: 'xml', doc }, feedUrl };
                            }
                        }
                    }
                } catch (e) {
                    console.warn('[own-api/rss] Failed:', e.message);
                }
            }

            // Strategy 1: rss2json (works on localhost + deployed)
            const r2j = await this.fetchViaRss2Json(feedUrl);
            if (r2j) return { method: 'rss2json', result: r2j, feedUrl };

            // Strategy 2: External CORS proxy + XML
            const proxy = await this.fetchViaProxy(feedUrl);
            if (proxy) return { method: 'proxy', result: proxy, feedUrl };
        }
        console.error('[RSS] All strategies failed for', source.key);
        return null;
    },

    // Reddit — tries own /api/reddit first (deployed), then direct, then CORS proxies
    async fetchReddit(source) {
        const redditUrl = source.urls[0];

        // Strategy 0: Own Vercel serverless API (deployed only)
        if (IS_DEPLOYED) {
            try {
                const apiUrl = OWN_REDDIT_API(redditUrl);
                console.log('[own-api/reddit] Trying:', redditUrl);
                const res = await this._fetch(apiUrl);
                if (res.ok) {
                    const data = await res.json();
                    if (data?.data?.children) {
                        console.log('[own-api/reddit] OK, posts:', data.data.children.length);
                        return data;
                    }
                }
            } catch (e) {
                console.warn('[own-api/reddit] Failed:', e.message);
            }
        }

        // Strategy 1: Direct (works in some browsers on localhost)
        try {
            console.log('[Reddit] Trying direct:', redditUrl);
            const res = await this._fetch(redditUrl, {}, 8000);
            if (res.ok) {
                const data = await res.json();
                console.log('[Reddit] Direct OK, posts:', data?.data?.children?.length);
                return data;
            }
        } catch (e) {
            console.warn('[Reddit] Direct failed:', e.message);
        }

        // Strategy 2: External CORS proxy
        for (const makeProxy of CORS_PROXIES) {
            try {
                const proxyUrl = makeProxy(redditUrl);
                console.log('[Reddit] Trying proxy:', proxyUrl.slice(0, 80));
                const res = await this._fetch(proxyUrl);
                if (!res.ok) continue;
                const text = await res.text();
                let jsonText = text;
                try {
                    const wrapped = JSON.parse(text);
                    if (wrapped.contents) jsonText = wrapped.contents;
                } catch { /* raw JSON */ }
                const data = JSON.parse(jsonText);
                console.log('[Reddit] Proxy OK, posts:', data?.data?.children?.length);
                return data;
            } catch (e) {
                console.warn('[Reddit] Proxy failed:', e.message);
            }
        }
        console.error('[Reddit] All strategies failed for', source.key);
        return null;
    },
};

/* ═══════════════════════════════════════════════════════════
   PARSER MODULE
═══════════════════════════════════════════════════════════ */
const Parser = {
    // Simple hash for dedup ID
    hashUrl(url) {
        let hash = 0;
        for (let i = 0; i < url.length; i++) {
            hash = ((hash << 5) - hash) + url.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    },

    stripHtml(html) {
        if (!html) return '';
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
    },

    truncate(str, len = 300) {
        const clean = this.stripHtml(str).trim();
        return clean.length > len ? clean.slice(0, len) + '…' : clean;
    },

    parseRSSItems(doc, source) {
        const items = [...doc.querySelectorAll('item, entry')];
        const articles = [];
        const cutoff = Date.now() - ARTICLE_WINDOW;

        for (const item of items) {
            const title = item.querySelector('title')?.textContent?.trim() || 'Untitled';
            const link = item.querySelector('link')?.textContent?.trim()
                || item.querySelector('link')?.getAttribute('href')
                || '#';
            const pubDate = item.querySelector('pubDate, published, updated')?.textContent?.trim();
            const desc = item.querySelector('description, summary, content')?.textContent?.trim() || '';
            const author = item.querySelector('author name, dc\\:creator, author')?.textContent?.trim() || source.label;

            // Thumbnail: try media:thumbnail → enclosure → first img in content HTML
            let thumbnail = null;
            const mediaThumbnail = item.querySelector('thumbnail');
            const enclosure = item.querySelector('enclosure[type^="image"]');
            const contentEncoded = item.querySelector('encoded')?.textContent
                || item.querySelector('content')?.textContent || '';

            if (mediaThumbnail) {
                thumbnail = mediaThumbnail.getAttribute('url');
            } else if (enclosure) {
                thumbnail = enclosure.getAttribute('url');
            } else if (contentEncoded) {
                // Parse HTML to find first image
                const tmp = document.createElement('div');
                tmp.innerHTML = contentEncoded;
                const img = tmp.querySelector('img[src]');
                if (img) thumbnail = img.getAttribute('src');
            }
            if (thumbnail && !thumbnail.startsWith('http')) thumbnail = null;

            const publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
            const publishedTs = new Date(publishedAt).getTime();

            // Filter to last 24h
            if (publishedTs < cutoff) continue;

            const id = this.hashUrl(link);
            articles.push({
                id,
                title,
                summary: this.truncate(desc, 280),
                url: link,
                source: source.key,
                source_label: source.label,
                published_at: publishedAt,
                author,
                score: null,
                thumbnail,
                saved: false,
            });
        }
        return articles;
    },

    // Parse rss2json.com API response
    parseRss2JsonItems(data, source) {
        const items = data.items || [];
        const articles = [];
        const cutoff = Date.now() - ARTICLE_WINDOW;

        for (const item of items) {
            const publishedTs = new Date(item.pubDate).getTime();
            if (publishedTs < cutoff) continue;

            const url = item.link || item.guid || '#';
            const id = this.hashUrl(url);

            // Thumbnail: rss2json provides thumbnail field, also check enclosure
            let thumbnail = null;
            if (item.thumbnail && item.thumbnail.startsWith('http')) {
                thumbnail = item.thumbnail;
            } else if (item.enclosure?.link?.startsWith('http') &&
                item.enclosure?.type?.startsWith('image')) {
                thumbnail = item.enclosure.link;
            } else if (item.description || item.content) {
                // Extract first img from HTML content
                const tmp = document.createElement('div');
                tmp.innerHTML = item.description || item.content || '';
                const img = tmp.querySelector('img[src]');
                if (img) thumbnail = img.getAttribute('src');
                if (thumbnail && !thumbnail.startsWith('http')) thumbnail = null;
            }

            articles.push({
                id,
                title: item.title || 'Untitled',
                summary: this.truncate(item.description || item.content || '', 280),
                url,
                source: source.key,
                source_label: source.label,
                published_at: new Date(item.pubDate).toISOString(),
                author: item.author || source.label,
                score: null,
                thumbnail,
                saved: false,
            });
        }
        return articles;
    },

    parseRedditPosts(data, source) {
        if (!data?.data?.children) return [];
        const cutoff = Date.now() - ARTICLE_WINDOW;
        const articles = [];

        for (const child of data.data.children) {
            const post = child.data;
            if (post.stickied) continue;
            const publishedTs = post.created_utc * 1000;
            if (publishedTs < cutoff) continue;

            const url = post.url.startsWith('http') ? post.url : `https://reddit.com${post.permalink}`;
            const id = this.hashUrl(url);

            // Thumbnail
            let thumbnail = null;
            if (post.thumbnail && post.thumbnail.startsWith('http')) thumbnail = post.thumbnail;
            else if (post.preview?.images?.[0]?.source?.url) {
                thumbnail = post.preview.images[0].source.url.replace(/&amp;/g, '&');
            }

            articles.push({
                id,
                title: post.title,
                summary: this.truncate(post.selftext || `Posted in ${source.sub || 'Reddit'} by u/${post.author}`, 280),
                url,
                source: 'reddit',
                source_label: 'Reddit',
                published_at: new Date(publishedTs).toISOString(),
                author: `u/${post.author} · ${source.sub}`,
                score: post.score,
                thumbnail,
                saved: false,
            });
        }
        return articles;
    },
};

/* ═══════════════════════════════════════════════════════════
   ORCHESTRATOR — Fetch all sources
═══════════════════════════════════════════════════════════ */
async function fetchAllSources() {
    UI.setStatus('loading', 'Fetching feeds…');

    const results = { bens_bites: [], rundown_ai: [], reddit: [] };
    const errors = [];

    // Fetch all 4 sources in parallel
    const [bensResult, rundownResult, redditArtResult, redditMLResult] = await Promise.allSettled([
        Fetcher.fetchRSS(SOURCES.bens_bites),
        Fetcher.fetchRSS(SOURCES.rundown_ai),
        Fetcher.fetchReddit(SOURCES.reddit_artificial),
        Fetcher.fetchReddit(SOURCES.reddit_ml),
    ]);

    // Parse Ben's Bites
    if (bensResult.status === 'fulfilled' && bensResult.value) {
        const r = bensResult.value;
        results.bens_bites = r.method === 'rss2json'
            ? Parser.parseRss2JsonItems(r.result.data, SOURCES.bens_bites)
            : Parser.parseRSSItems(r.result.doc, SOURCES.bens_bites);
    } else {
        errors.push("Ben's Bites");
    }

    // Parse Rundown AI
    if (rundownResult.status === 'fulfilled' && rundownResult.value) {
        const r = rundownResult.value;
        results.rundown_ai = r.method === 'rss2json'
            ? Parser.parseRss2JsonItems(r.result.data, SOURCES.rundown_ai)
            : Parser.parseRSSItems(r.result.doc, SOURCES.rundown_ai);
    } else {
        errors.push('The Rundown AI');
    }

    // Parse Reddit
    const redditArticles = [];
    if (redditArtResult.status === 'fulfilled' && redditArtResult.value) {
        redditArticles.push(...Parser.parseRedditPosts(redditArtResult.value, SOURCES.reddit_artificial));
    } else {
        errors.push('Reddit r/artificial');
    }
    if (redditMLResult.status === 'fulfilled' && redditMLResult.value) {
        redditArticles.push(...Parser.parseRedditPosts(redditMLResult.value, SOURCES.reddit_ml));
    } else {
        errors.push('Reddit r/MachineLearning');
    }
    results.reddit = redditArticles;

    // Merge + deduplicate
    const seen = new Set();
    const all = [];
    for (const arr of Object.values(results)) {
        for (const article of arr) {
            if (!seen.has(article.id)) {
                seen.add(article.id);
                all.push(article);
            }
        }
    }

    // Sort newest first by default
    all.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));

    // Persist
    Storage.setArticles(all);
    Storage.setLastFetch(Date.now());

    return { articles: all, errors };
}

/* ═══════════════════════════════════════════════════════════
   UI MODULE
═══════════════════════════════════════════════════════════ */
const UI = {
    setStatus(type, label) {
        const dot = document.getElementById('status-dot');
        const lbl = document.getElementById('status-label');
        const time = document.getElementById('status-time');
        const btn = document.getElementById('refresh-btn');

        dot.className = `status-dot ${type}`;
        lbl.textContent = label;

        if (type === 'live') {
            const last = Storage.getLastFetch();
            time.textContent = last ? `Updated ${timeAgo(last)}` : '';
        } else {
            time.textContent = '';
        }

        if (type === 'loading') {
            btn.classList.add('spinning');
            btn.disabled = true;
        } else {
            btn.classList.remove('spinning');
            btn.disabled = false;
        }
    },

    updateStats(articles) {
        const bens = articles.filter(a => a.source === 'bens_bites').length;
        const rundown = articles.filter(a => a.source === 'rundown_ai').length;
        const reddit = articles.filter(a => a.source === 'reddit').length;
        const saved = state.savedIds.size;

        document.querySelector('#stat-total .stat-value').textContent = articles.length;
        document.querySelector('#stat-bens .stat-value').textContent = bens;
        document.querySelector('#stat-rundown .stat-value').textContent = rundown;
        document.querySelector('#stat-reddit .stat-value').textContent = reddit;
        document.querySelector('#stat-saved .stat-value').textContent = saved;

        document.getElementById('badge-all').textContent = articles.length;
        document.getElementById('badge-bens').textContent = bens;
        document.getElementById('badge-rundown').textContent = rundown;
        document.getElementById('badge-reddit').textContent = reddit;
        document.getElementById('badge-saved').textContent = saved;
    },

    renderArticles(articles) {
        const grid = document.getElementById('articles-grid');
        const empty = document.getElementById('empty-state');

        // Remove skeletons
        grid.querySelectorAll('.skeleton-card').forEach(el => el.remove());

        if (articles.length === 0) {
            grid.innerHTML = '';
            empty.classList.remove('hidden');

            const filter = state.currentFilter;
            document.getElementById('empty-title').textContent =
                filter === 'saved' ? 'No saved articles yet' : 'No articles found';
            document.getElementById('empty-subtitle').textContent =
                filter === 'saved'
                    ? 'Bookmark articles to save them here.'
                    : 'Try a different filter or refresh the feed.';
            return;
        }

        empty.classList.add('hidden');

        // Build cards
        const fragment = document.createDocumentFragment();
        articles.forEach((article, i) => {
            const card = this.buildCard(article, i);
            fragment.appendChild(card);
        });

        grid.innerHTML = '';
        grid.appendChild(fragment);
    },

    buildCard(article, index) {
        const isSaved = state.savedIds.has(article.id);
        const sourceKey = article.source === 'bens_bites' ? 'bens'
            : article.source === 'rundown_ai' ? 'rundown'
                : 'reddit';
        const badgeClass = `badge-${sourceKey}`;
        const sourceColor = article.source === 'bens_bites' ? '#BFF549'
            : article.source === 'rundown_ai' ? '#5B8DEF'
                : '#FF6B35';

        const card = document.createElement('article');
        card.className = 'article-card';
        card.style.setProperty('--source-color', sourceColor);
        card.style.animationDelay = `${Math.min(index * 0.04, 0.4)}s`;
        card.dataset.id = article.id;

        // Always show an image — real thumbnail or branded SVG placeholder
        const imgSrc = (article.thumbnail && article.thumbnail.startsWith('http'))
            ? article.thumbnail
            : makePlaceholder(article);
        const isPlaceholder = !article.thumbnail || !article.thumbnail.startsWith('http');

        card.innerHTML = `
      <div class="card-image${isPlaceholder ? ' card-image--placeholder' : ''}">
        <img src="${imgSrc}" alt="" loading="lazy"${isPlaceholder ? '' : ' onerror="this.src=\'' + makePlaceholder(article).replace(/'/g, "\\'") + '\'"'}>
        <div class="card-image-overlay">
          <span class="source-badge ${badgeClass}">${article.source_label}</span>
          <button class="save-btn ${isSaved ? 'saved' : ''}" data-id="${article.id}" aria-label="${isSaved ? 'Unsave' : 'Save'} article">
            <svg viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="card-body">
        <h2 class="card-title">${escapeHtml(article.title)}</h2>
        ${article.summary ? `<p class="card-summary">${escapeHtml(article.summary)}</p>` : ''}
        <div class="card-footer">
          <div class="card-meta">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${formatTime(article.published_at)}
          </div>
          ${article.score !== null ? `
            <div class="card-score">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
              ${formatScore(article.score)}
            </div>` : ''}
          <span class="card-read-link">
            Read
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </span>
        </div>
      </div>
    `;


        // Click card → open modal
        card.addEventListener('click', (e) => {
            if (e.target.closest('.save-btn')) return;
            openModal(article);
        });

        // Save button
        card.querySelector('.save-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSave(article.id);
        });

        return card;
    },


    showError(errors) {
        if (!errors || errors.length === 0) return;
        const banner = document.getElementById('error-banner');
        document.getElementById('error-text').textContent =
            `Some sources failed to load: ${errors.join(', ')}. Showing available data.`;
        banner.classList.remove('hidden');
        setTimeout(() => banner.classList.add('hidden'), 8000);
    },
};

/* ═══════════════════════════════════════════════════════════
   FILTERING & SORTING
═══════════════════════════════════════════════════════════ */
function getFilteredArticles() {
    let articles = [...state.allArticles];

    // Apply saved IDs to articles
    articles = articles.map(a => ({ ...a, saved: state.savedIds.has(a.id) }));

    // Source filter
    if (state.currentFilter === 'saved') {
        articles = articles.filter(a => a.saved);
    } else if (state.currentFilter !== 'all') {
        articles = articles.filter(a => {
            if (state.currentFilter === 'reddit') return a.source === 'reddit';
            return a.source === state.currentFilter;
        });
    }

    // Search
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        articles = articles.filter(a =>
            a.title.toLowerCase().includes(q) ||
            a.summary.toLowerCase().includes(q) ||
            a.author.toLowerCase().includes(q)
        );
    }

    // Sort
    if (state.sortOrder === 'newest') {
        articles.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    } else if (state.sortOrder === 'oldest') {
        articles.sort((a, b) => new Date(a.published_at) - new Date(b.published_at));
    } else if (state.sortOrder === 'score') {
        articles.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    return articles;
}

function rerender() {
    const filtered = getFilteredArticles();
    UI.renderArticles(filtered);
    UI.updateStats(state.allArticles);
}

/* ═══════════════════════════════════════════════════════════
   SAVE / UNSAVE
═══════════════════════════════════════════════════════════ */
function toggleSave(id) {
    const wasSaved = state.savedIds.has(id);
    if (wasSaved) {
        state.savedIds.delete(id);
        showToast('Article removed from saved', 'default');
    } else {
        state.savedIds.add(id);
        showToast('Article saved! 🔖', 'success');
    }
    Storage.saveSavedIds(state.savedIds);

    // Update card button in DOM
    const btn = document.querySelector(`.save-btn[data-id="${id}"]`);
    if (btn) {
        btn.classList.toggle('saved', !wasSaved);
        btn.querySelector('svg').setAttribute('fill', !wasSaved ? 'currentColor' : 'none');
        btn.setAttribute('aria-label', !wasSaved ? 'Unsave article' : 'Save article');
    }

    // Update modal save button if open
    if (state.activeModal?.id === id) {
        updateModalSaveBtn(!wasSaved);
    }

    // Update stats
    document.querySelector('#stat-saved .stat-value').textContent = state.savedIds.size;
    document.getElementById('badge-saved').textContent = state.savedIds.size;

    // If in saved filter, re-render
    if (state.currentFilter === 'saved') rerender();
}

/* ═══════════════════════════════════════════════════════════
   MODAL
═══════════════════════════════════════════════════════════ */
function openModal(article) {
    state.activeModal = article;
    const overlay = document.getElementById('modal-overlay');
    const sourceKey = article.source === 'bens_bites' ? 'bens'
        : article.source === 'rundown_ai' ? 'rundown'
            : 'reddit';

    document.getElementById('modal-badge').textContent = article.source_label;
    document.getElementById('modal-badge').className = `modal-badge source-badge badge-${sourceKey}`;
    document.getElementById('modal-title').textContent = article.title;
    document.getElementById('modal-summary').textContent = article.summary || 'No summary available.';
    document.getElementById('modal-link').href = article.url;
    document.getElementById('modal-meta').innerHTML = `
    <span>🕐 ${formatTime(article.published_at)}</span>
    <span>✍️ ${escapeHtml(article.author)}</span>
    ${article.score !== null ? `<span>⬆️ ${formatScore(article.score)} upvotes</span>` : ''}
  `;

    updateModalSaveBtn(state.savedIds.has(article.id));
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function updateModalSaveBtn(isSaved) {
    const btn = document.getElementById('modal-save-btn');
    btn.className = `btn-secondary ${isSaved ? 'saved' : ''}`;
    btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
    </svg>
    ${isSaved ? 'Saved ✓' : 'Save Article'}
  `;
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    state.activeModal = null;
}

/* ═══════════════════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════════════════ */
let toastTimer;
function showToast(msg, type = 'default') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 2800);
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */

// Generate a branded SVG placeholder image as a data-URI
function makePlaceholder(article) {
    const colors = {
        bens_bites: { bg1: '#1a2a0a', bg2: '#0d1a05', accent: '#BFF549' },
        rundown_ai: { bg1: '#0a1020', bg2: '#050a18', accent: '#5B8DEF' },
        reddit: { bg1: '#1a0f08', bg2: '#100805', accent: '#FF6B35' },
    };
    const c = colors[article.source] || colors.reddit;
    const label = article.source_label.toUpperCase();
    // Truncate title for display in SVG
    const title = article.title.length > 60
        ? article.title.slice(0, 57) + '...'
        : article.title;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c.bg1}"/>
      <stop offset="100%" stop-color="${c.bg2}"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${c.accent}" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="${c.accent}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect width="800" height="450" fill="url(#g)"/>
  <rect width="800" height="450" fill="url(#shine)"/>
  <!-- Grid lines -->
  <line x1="0" y1="150" x2="800" y2="150" stroke="${c.accent}" stroke-opacity="0.04" stroke-width="1"/>
  <line x1="0" y1="300" x2="800" y2="300" stroke="${c.accent}" stroke-opacity="0.04" stroke-width="1"/>
  <line x1="200" y1="0" x2="200" y2="450" stroke="${c.accent}" stroke-opacity="0.04" stroke-width="1"/>
  <line x1="400" y1="0" x2="400" y2="450" stroke="${c.accent}" stroke-opacity="0.04" stroke-width="1"/>
  <line x1="600" y1="0" x2="600" y2="450" stroke="${c.accent}" stroke-opacity="0.04" stroke-width="1"/>
  <!-- Accent circle -->
  <circle cx="680" cy="80" r="120" fill="${c.accent}" fill-opacity="0.05"/>
  <circle cx="680" cy="80" r="70" fill="${c.accent}" fill-opacity="0.06"/>
  <!-- Source badge -->
  <rect x="40" y="40" width="${label.length * 9 + 24}" height="28" rx="4" fill="${c.accent}" fill-opacity="0.15"/>
  <text x="52" y="59" font-family="Inter,Arial,sans-serif" font-size="11" font-weight="700" letter-spacing="1.5" fill="${c.accent}">${label}</text>
  <!-- Title text (word-wrapped via tspan) -->
  <text font-family="Inter,Arial,sans-serif" font-size="26" font-weight="700" fill="white" fill-opacity="0.9">
    <tspan x="40" y="220">${escapeHtmlSvg(title.slice(0, 38))}</tspan>
    ${title.length > 38 ? `<tspan x="40" dy="36">${escapeHtmlSvg(title.slice(38, 76))}</tspan>` : ''}
    ${title.length > 76 ? `<tspan x="40" dy="36">${escapeHtmlSvg(title.slice(76))}</tspan>` : ''}
  </text>
  <!-- Bottom accent line -->
  <rect x="40" y="380" width="80" height="3" rx="1.5" fill="${c.accent}" fill-opacity="0.6"/>
  <text x="40" y="420" font-family="Inter,Arial,sans-serif" font-size="12" fill="white" fill-opacity="0.3">ainewz.ai</text>
</svg>`;

    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function escapeHtmlSvg(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


function timeAgo(ts) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

function formatTime(iso) {
    try {
        const d = new Date(iso);
        const diff = Date.now() - d.getTime();
        const m = Math.floor(diff / 60000);
        if (m < 1) return 'Just now';
        if (m < 60) return `${m}m ago`;
        const h = Math.floor(m / 60);
        if (h < 24) return `${h}h ago`;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return ''; }
}

function formatScore(score) {
    if (score >= 1000) return (score / 1000).toFixed(1) + 'k';
    return score.toString();
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* ═══════════════════════════════════════════════════════════
   EVENT LISTENERS
═══════════════════════════════════════════════════════════ */
function initEventListeners() {
    // Nav filter
    document.querySelectorAll('.nav-item[data-filter]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const filter = item.dataset.filter;
            state.currentFilter = filter;

            // Update active state
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Update page title
            const titles = {
                all: 'All Sources',
                bens_bites: 'Ben\'s Bites',
                rundown_ai: 'The Rundown AI',
                reddit: 'Reddit',
                saved: 'Saved Articles',
            };
            document.getElementById('page-title').textContent = titles[filter] || 'All Sources';

            rerender();
        });
    });

    // Search
    let searchTimer;
    document.getElementById('search-input').addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.searchQuery = e.target.value.trim();
            rerender();
        }, 250);
    });

    // Sort
    document.getElementById('sort-select').addEventListener('change', (e) => {
        state.sortOrder = e.target.value;
        rerender();
    });

    // Refresh button
    document.getElementById('refresh-btn').addEventListener('click', async () => {
        Storage.set(STORAGE_KEYS.lastFetch, 0); // Invalidate cache
        await loadData(true);
    });

    // Modal close
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });

    // Modal save button
    document.getElementById('modal-save-btn').addEventListener('click', () => {
        if (state.activeModal) toggleSave(state.activeModal.id);
    });

    // Sidebar toggle (mobile)
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
    });

    // Close sidebar on outside click (mobile)
    document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('sidebar');
        const toggle = document.getElementById('sidebar-toggle');
        if (sidebar.classList.contains('open') &&
            !sidebar.contains(e.target) &&
            !toggle.contains(e.target)) {
            sidebar.classList.remove('open');
        }
    });
}

/* ═══════════════════════════════════════════════════════════
   MAIN INIT
═══════════════════════════════════════════════════════════ */
async function loadData(forceRefresh = false) {
    UI.setStatus('loading', 'Fetching feeds…');

    let articles = [];
    let errors = [];

    if (!forceRefresh && Storage.isCacheValid()) {
        // Load from cache
        articles = Storage.getArticles();
        UI.setStatus('live', 'Live');
        showToast('Loaded from cache', 'default');
    } else {
        // Fetch fresh
        try {
            const result = await fetchAllSources();
            articles = result.articles;
            errors = result.errors;

            if (errors.length > 0) {
                UI.setStatus('error', 'Partial data');
                UI.showError(errors);
            } else {
                UI.setStatus('live', 'Live');
            }

            if (articles.length > 0) {
                showToast(`✅ ${articles.length} articles loaded`, 'success');
            } else {
                showToast('No new articles in the last 24h', 'default');
            }
        } catch (err) {
            console.error('Fatal fetch error:', err);
            UI.setStatus('error', 'Fetch failed');
            // Try to fall back to cache
            articles = Storage.getArticles();
            if (articles.length > 0) {
                showToast('Using cached data', 'default');
            } else {
                showToast('Failed to load articles', 'error');
            }
        }
    }

    state.allArticles = articles;
    rerender();
}

async function init() {
    // Load saved IDs from storage
    state.savedIds = Storage.getSavedIds();

    // Init event listeners
    initEventListeners();

    // Update status time
    const lastFetch = Storage.getLastFetch();
    if (lastFetch) {
        document.getElementById('status-time').textContent = `Last: ${timeAgo(lastFetch)}`;
    }

    // Load data
    await loadData();
}

// Boot
document.addEventListener('DOMContentLoaded', init);
