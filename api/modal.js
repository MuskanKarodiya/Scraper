/**
 * /api/modal — Vercel serverless proxy to the Modal pre-scraped endpoint.
 *
 * Why this exists:
 *   The browser can't call Modal directly because when Modal's container is
 *   cold-starting, its load balancer returns a 502 WITHOUT CORS headers.
 *   The browser immediately blocks the read ("TypeError: Failed to fetch").
 *   Routing through this Vercel function fixes both issues:
 *     1. No CORS — browser calls its own domain (/api/modal)
 *     2. Server-to-server — no CORS header needed between Vercel and Modal
 */

const MODAL_ENDPOINT =
  'https://muskankarodiya06o--ainewz-scraper-get-articles.modal.run';

module.exports = async (req, res) => {
  // CORS headers so the browser is happy
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Node 18 has built-in fetch — no dependencies needed
    const response = await fetch(MODAL_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      // No timeout here — Vercel's own function timeout applies (10s Hobby / 60s Pro)
      // If Modal is warm, it responds in <2s; if cold, Vercel may 504 — that's fine,
      // the frontend catches non-2xx and falls through to the live fetch.
    });

    if (!response.ok) {
      console.error(`[modal-proxy] Modal returned ${response.status}`);
      return res
        .status(502)
        .json({ error: `Modal returned ${response.status}` });
    }

    const data = await response.json();

    // Cache at Vercel's edge for 55 min (Modal itself caches for 60 min)
    res.setHeader('Cache-Control', 's-maxage=3300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (err) {
    console.error('[modal-proxy] Fetch error:', err.message);
    return res.status(502).json({ error: err.message });
  }
};
