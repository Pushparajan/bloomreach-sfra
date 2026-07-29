'use strict';

/**
 * Resolves the Bloomreach `user_id` param for the current shopper, when
 * logged in. Per the integration spec, user_id is sent for Boot Finder and
 * the Comparison Tool ONLY - Work Job Landing and free-text Search/
 * Autosuggest (helpers/bloomreachSearchHelper) are explicitly excluded
 * (shared, non-personalized, cacheable routes - see cache.applyDefaultCache
 * on Work-JobLanding), so those callers must not use this helper. The
 * nightly GenerateThematicPages batch job has no shopper/request context at
 * all, so it never applies either.
 *
 * ASSUMPTION (flagged per this cartridge's convention of calling out
 * unverified integration points): "logged in user id" means
 * dw.customer.Customer.ID (the standard SFCC customer id) for an
 * AUTHENTICATED customer only - never a guest/session id. Confirm with the
 * Bloomreach account team whether a different identifier (e.g. a hashed id)
 * is expected before shipping; only this module needs to change if so.
 */

/**
 * @param {dw.customer.Customer} currentCustomer - req.currentCustomer.raw
 * @returns {string|null} the customer id, or null when not logged in
 */
function resolveUserId(currentCustomer) {
    if (!currentCustomer || !currentCustomer.authenticated) {
        return null;
    }
    return currentCustomer.ID || null;
}

module.exports = {
    resolveUserId: resolveUserId
};
