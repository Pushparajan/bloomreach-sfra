'use strict';

/**
 * Loomi Conversational Search - DO NOT IMPLEMENT.
 *
 * This feature is license-gated and not yet approved for build. This file
 * is a feature-flagged stub ONLY: when loomi.enabled is false (the required
 * default), it returns a clean "not available" response and does nothing
 * else. No AI/NLU service is called, no license key is referenced, no UI is
 * built for this feature - do not add any of that here without an explicit,
 * separate approval to build the real feature.
 *
 * ---------------------------------------------------------------------
 * Intended request/response shape for a future implementer (NOT LIVE):
 *
 *   GET Loomi-Query?q=<free text query>
 *
 *   Request:
 *     q (string) - shopper's free-text conversational query, e.g.
 *       "waterproof composite toe boots for electrical work under $150"
 *
 *   Response (200, when loomi.enabled=true):
 *     {
 *       "interpreted": {
 *         // Same attribute set Boot Finder uses - see
 *         // bloomreachConstants.ATTRIBUTES - mapped from the free-text
 *         // query by the (not-yet-built) NLU layer, e.g.:
 *         "job_type": "electrical",
 *         "feature_waterproof": true,
 *         "Toe_Shape": "Composite",
 *         "priceMax": 150
 *       },
 *       "results": [
 *         // Same VG-level result shape as BootFinder-Results:
 *         // { vgId, name, image, price, bvRating, bvReviewCount, chips }
 *       ]
 *     }
 *
 *   Response (200, when loomi.enabled=false - the current, only live path):
 *     { "available": false }
 * ---------------------------------------------------------------------
 */

var server = require('server');
var featureFlags = require('*/cartridge/scripts/helpers/featureFlags');

server.get('Query', function (req, res, next) {
    if (!featureFlags.isEnabled('LOOMI_ENABLED')) {
        res.setStatusCode(200);
        res.json({ available: false });
        next();
        return;
    }

    // Intentionally unreachable while loomi.enabled defaults to false.
    // Do not implement beyond this point without explicit approval.
    res.setStatusCode(501);
    res.json({ available: false, error: 'Loomi is approved but not yet implemented.' });
    next();
});

module.exports = server.exports();
