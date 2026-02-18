/**
 * Vercel Serverless Function: /api/reddit
 * Fetches Reddit JSON server-side with a proper User-Agent.
 * No CORS issues — runs on Vercel's Node.js runtime.
 *
 * Usage: GET /api/reddit?url=https://www.reddit.com/r/artificial/new.json?limit=50
 */

module.exports = async function handler(req, res) {
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

    let redditUrl;
    try {
        redditUrl = new URL(url);
        if (!redditUrl.hostname.endsWith('reddit.com')) {
            throw new Error('Only reddit.com URLs are allowed');
        }
        if (!['http:', 'https:'].includes(redditUrl.protocol)) {
            throw new Error('Invalid protocol');
        }
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }

    try {
        const https = require('https');

        const data = await new Promise((resolve, reject) => {
            const options = {
                hostname: redditUrl.hostname,
                path: redditUrl.pathname + redditUrl.search,
                headers: {
                    'User-Agent': 'AINewz-Dashboard/1.0 (by /u/ainewz_bot)',
                    'Accept': 'application/json',
                },
                timeout: 10000,
            };

            const req2 = https.get(options, (response) => {
                if (response.statusCode >= 400) {
                    reject(new Error(`Reddit returned ${response.statusCode}`));
                    return;
                }
                let raw = '';
                response.on('data', chunk => raw += chunk);
                response.on('end', () => {
                    try { resolve(JSON.parse(raw)); }
                    catch (e) { reject(new Error('Invalid JSON from Reddit')); }
                });
            });

            req2.on('error', reject);
            req2.on('timeout', () => { req2.destroy(); reject(new Error('Timeout')); });
        });

        // Cache for 5 minutes
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).json(data);

    } catch (err) {
        console.error('[api/reddit] Error fetching', redditUrl.toString(), err.message);
        return res.status(500).json({ error: err.message });
    }
};
