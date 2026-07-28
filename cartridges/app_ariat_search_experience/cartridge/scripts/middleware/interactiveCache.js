'use strict';

/**
 * Explicit cache exclusion for stateful/per-request routes (Boot Finder,
 * Comparison Tool). This is a DELIBERATE, DOCUMENTED deviation from the
 * site's default full-page cache - these routes render per-shopper answer
 * state and must never be served from a shared page cache. Guided Landing
 * Pages (Feature 3) intentionally do NOT use this middleware; they use the
 * standard SFRA cache middleware instead, same as any other PLP/category
 * page.
 */
function applyNoCache(req, res, next) {
    res.cachePeriod = 0;
    res.cachePeriodUnit = 'minutes';
    res.personalized = true;
    next();
}

module.exports = {
    applyNoCache: applyNoCache
};
