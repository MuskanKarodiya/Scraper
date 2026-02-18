/**
 * Vercel Serverless Function: /api/rss
 * Fetches an RSS feed URL server-side and returns the raw XML.
 * Follows redirects (up to 5 hops).
 *
 * Usage: GET /api/rss?url=https://bensbites.beehiiv.com/feed
 */

const https = require('https');
const http = require('http');

function fetchWithRedirects(urlStr, redirectsLeft = 5) {
    return new Promise((resolve, reject) => {
        if (redirectsLeft === 0) return reject(new Error('Too many redirects'));

        let parsed;
        try { parsed = new URL(urlStr); } catch (e) { return reject(e); }

        const client = parsed.protocol === 'https:' ? https : http;
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; AINewz-Bot/1.0; +https://ainewz.ai)',
                'Accept': 'application/rss+xml, application/xml, text/xml, */*',
                'Accept-Encoding': 'identity',
            },
            timeout: 12000,
        };

        const req = client.get(options, (res) => {
            // Follow redirects
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                const next = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : `${parsed.protocol}//${parsed.hostname}${res.headers.location}`;
                res.resume(); // discard body
                return resolve(fetchWithRedirects(next, redirectsLeft - 1));
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

    let feedUrl;
    try {
        feedUrl = new URL(url);
        if (!['http:', 'https:'].includes(feedUrl.protocol)) throw new Error('Invalid protocol');
    } catch {
        return res.status(400).json({ error: 'Invalid URL' });
    }

    try {
        const xml = await fetchWithRedirects(feedUrl.toString());
        res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        return res.status(200).send(xml);
    } catch (err) {
        console.error('[api/rss] Error:', feedUrl.toString(), err.message);
        return res.status(500).json({ error: err.message });
    }
};
