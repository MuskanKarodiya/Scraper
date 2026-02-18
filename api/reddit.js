/**
 * Vercel Serverless Function: /api/reddit
 * Fetches Reddit JSON server-side with a proper User-Agent.
 * No CORS issues — runs on Vercel's Node.js runtime.
 *
 * Usage: GET /api/reddit?url=https://www.reddit.com/r/artificial/new.json?limit=50
 */

export default async function handler(req, res) {
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
        const response = await fetch(redditUrl.toString(), {
            headers: {
                'User-Agent': 'AINewz-Dashboard/1.0 (by /u/ainewz_bot)',
                'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
            return res.status(response.status).json({
                error: `Reddit returned ${response.status}`,
            });
        }

        const data = await response.json();

        // Cache for 5 minutes
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
        res.setHeader('Content-Type', 'application/json');
        return res.status(200).json(data);

    } catch (err) {
        console.error('[api/reddit] Error fetching', redditUrl.toString(), err.message);
        return res.status(500).json({ error: err.message });
    }
}
