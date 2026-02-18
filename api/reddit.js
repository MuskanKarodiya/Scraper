/**
 * Vercel Serverless Function: /api/reddit
 * Fetches Reddit RSS feed server-side (RSS is more permissive than JSON API).
 * Falls back to JSON API if RSS fails.
 *
 * Usage: GET /api/reddit?url=https://www.reddit.com/r/artificial/new.json?limit=50
 */

const https = require('https');

function fetchWithRedirects(urlStr, extraHeaders = {}, redirectsLeft = 5) {
    return new Promise((resolve, reject) => {
        if (redirectsLeft === 0) return reject(new Error('Too many redirects'));

        let parsed;
        try { parsed = new URL(urlStr); } catch (e) { return reject(e); }

        const options = {
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: parsed.pathname + parsed.search,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; AINewz-Bot/1.0; +https://ainewz.ai)',
                'Accept': 'application/json, application/rss+xml, */*',
                'Accept-Encoding': 'identity',
                ...extraHeaders,
            },
            timeout: 12000,
        };

        const req = https.get(options, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                const next = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : `https://${parsed.hostname}${res.headers.location}`;
                res.resume();
                return resolve(fetchWithRedirects(next, extraHeaders, redirectsLeft - 1));
            }

            if (res.statusCode >= 400) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }

            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing ?url= parameter' });

    let redditUrl;
    try {
        redditUrl = new URL(url);
        if (!redditUrl.hostname.endsWith('reddit.com')) {
            throw new Error('Only reddit.com URLs are allowed');
        }
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    // Convert JSON API URL to RSS URL (more permissive, works from datacenters)
    // e.g. /r/artificial/new.json?limit=50 → /r/artificial/new.rss?limit=50
    const rssPath = redditUrl.pathname.replace(/\.json$/, '.rss') + '?limit=50&sort=new';
    const rssUrl = `https://www.reddit.com${rssPath}`;

    try {
        console.log('[api/reddit] Fetching RSS:', rssUrl);
        const xml = await fetchWithRedirects(rssUrl);

        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        return res.status(200).send(xml);
    } catch (err) {
        console.error('[api/reddit] RSS failed:', err.message, '— trying JSON API');

        // Fallback: try JSON API directly
        try {
            const jsonUrl = redditUrl.toString();
            const raw = await fetchWithRedirects(jsonUrl);
            const data = JSON.parse(raw);
            res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
            res.setHeader('Content-Type', 'application/json');
            return res.status(200).json(data);
        } catch (err2) {
            console.error('[api/reddit] JSON fallback also failed:', err2.message);
            return res.status(500).json({ error: err.message });
        }
    }
};
