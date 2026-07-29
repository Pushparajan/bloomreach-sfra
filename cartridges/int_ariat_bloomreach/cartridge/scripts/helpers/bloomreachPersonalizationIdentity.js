'use strict';

/**
 * R-38: single source of truth for "who is this shopper," used identically
 * by every 1:1-personalization query-time call. (No pixel/analytics identity
 * mechanism exists elsewhere in this codebase to reuse - see "ASSUMPTION"
 * below - so this is the only identity resolution point today.)
 *
 * Per the integration spec, user_id is sent for Boot Finder and the
 * Comparison Tool ONLY - Work Job Landing's shell and free-text Search/
 * Autosuggest (helpers/bloomreachSearchHelper) are explicitly excluded
 * (shared, non-personalized, cacheable routes), so those call sites must
 * never call this helper. Work Job Landing's separate personalized-strip
 * fragment (see controllers/Work.js `PersonalizedStrip`) DOES call it, since
 * that fragment - unlike the shell - is a per-shopper, uncached response.
 * The nightly GenerateThematicPages batch job has no shopper/request
 * context at all, so it never applies either.
 *
 * The flag check lives HERE, not at each call site, so it is structurally
 * impossible for a caller to leak a user_id while the flag is off - there is
 * no way to bypass this by forgetting a check elsewhere. This satisfies the
 * non-negotiable constraint: no shopper-identifying value is sent to
 * Bloomreach while personalization.oneToOne.enabled is off, under any code
 * path, including future ones.
 *
 * ASSUMPTION (flagged rather than guessed, per this cartridge's convention
 * of calling out unverified integration points - and per explicit
 * instruction not to invent a hashing scheme): no existing pixel/analytics
 * identity computation was found in this codebase to mirror (see
 * client/default/js/shared/gtmEvents.js's own "no existing GTM dataLayer
 * implementation was found" disclosure). This resolves to the raw SFCC
 * dw.customer.Customer.ID as a DOCUMENTED PLACEHOLDER, not a confirmed
 * final value. Before this ships: (1) confirm with the Bloomreach account
 * team what identity value they expect (raw id vs. a hash vs. something
 * else), and (2) once a real pixel/tracking identity mechanism exists,
 * update BOTH that mechanism and this resolveShopperIdentity function
 * together so they never diverge - see this module's header comment on why
 * divergence breaks Bloomreach's ability to tie query-time personalization
 * to behavioral history.
 */

var featureFlags = require('./featureFlags');

/**
 * @param {dw.customer.Customer} customer - current session customer, e.g.
 *   req.currentCustomer.raw
 * @returns {{userId: string|null, isLoggedIn: boolean}} userId is null
 *   whenever personalization.oneToOne.enabled is off, OR the shopper is a
 *   guest, OR the customer argument is missing/ambiguous - never guessed.
 *   isLoggedIn reflects actual authentication state independent of the flag.
 */
function resolveShopperIdentity(customer) {
    var isLoggedIn = !!(customer && customer.authenticated);

    if (!featureFlags.isEnabled('PERSONALIZATION_ONE_TO_ONE') || !isLoggedIn) {
        return { userId: null, isLoggedIn: isLoggedIn };
    }

    return { userId: customer.ID || null, isLoggedIn: isLoggedIn };
}

module.exports = {
    resolveShopperIdentity: resolveShopperIdentity
};
