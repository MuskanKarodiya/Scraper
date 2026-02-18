/**
 * Vercel Serverless Function: /api/rss
 * Fetches an RSS feed URL server-side and returns the raw XML.
 * No CORS issues — runs on Vercel's Node.js runtime.
 *
 * Usage: GET /api/rss?url=https://bensbites.beehiiv.com/feed
 */

module.exports = async function handler(req, res) {
    // CORS headers so the browser can call this endpoint
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { url } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'Missing ?url= parameter' });
    }

    // Basic URL validation — only allow http/https
    let feedUrl;
    try {
        feedUrl = new URL(url);
        if (!['http:', 'https:'].includes(feedUrl.protocol)) {
            throw new Error('Invalid protocol');
        }
    } catch {
        return res.status(400).json({ error: 'Invalid URL' });
    }

    try {
        const https = require('https');
        const http = require('http');
        const client = feedUrl.protocol === 'https:' ? https : http;

        const xml = await new Promise((resolve, reject) => {
            const options = {
                hostname: feedUrl.hostname,
                path: feedUrl.pathname + feedUrl.search,
                headers: {
                    'User-Agent': 'AINewz-Dashboard/1.0 (RSS Reader)',
                    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
                },
                timeout: 10000,
            };

            const req2 = client.get(options, (response) => {
                if (response.statusCode >= 400) {
                    reject(new Error(`Upstream returned ${response.statusCode}`));
                    return;
                }
                // Handle redirects
                if (response.statusCode >= 300 && response.headers.location) {
                    reject(new Error(`Redirect to ${response.headers.location}`));
                    return;
                }
                let data = '';
                response.on('data', chunk => data += chunk);
                response.on('end', () => resolve(data));
            });

            req2.on('error', reject);
            req2.on('timeout', () => { req2.destroy(); reject(new Error('Timeout')); });
        });

        // Cache for 15 minutes on Vercel edge
        res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        return res.status(200).send(xml);

    } catch (err) {
        console.error('[api/rss] Error fetching', feedUrl.toString(), err.message);
        return res.status(500).json({ error: err.message });
    }
};
