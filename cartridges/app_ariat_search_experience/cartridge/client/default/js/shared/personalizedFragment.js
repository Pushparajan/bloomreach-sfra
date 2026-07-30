'use strict';

/**
 * R-38: shared client-side fetch/injection logic for 1:1-personalized
 * fragments, reused by product/personalizedStrip.js (PDP) and
 * search/personalizedRail.js (Category/PLP) rather than duplicating the
 * same fetch/degrade logic - the original of this exact shell+fragment
 * pattern is client/default/js/work/jobLandingPersonalizedStrip.js,
 * applied first to Work Job Landing.
 *
 * Two things this module does WITHOUT any base-cartridge template change,
 * since the real PDP/Category templates aren't available to this cartridge
 * to modify or confirm against:
 *
 * 1. Resolves the fragment controller's URL, preferring a server-rendered
 *    one and falling back to deriving it from the current page's URL. See
 *    resolveFragmentUrl below - the fallback deliberately REFUSES to guess
 *    on SEO-friendly URLs rather than requesting a wrong one.
 * 2. Injects the fragment's response into `#maincontent` - SFRA's standard
 *    accessibility skip-link target (`<a href="#maincontent">Skip to main
 *    content</a>`), which is about as close to a universal, rarely-touched
 *    landmark as SFRA-based storefronts have. This is a documented
 *    ASSUMPTION, not a confirmed base-template hook: ideally a real
 *    integration would place this fragment more precisely (e.g. directly
 *    after the main product grid), which requires a real base-cartridge
 *    template change this cartridge cannot make on its own. Confirm
 *    against the real base cartridge and adjust the selector/insertion
 *    point here if a more precise placement is wanted - only this file
 *    needs to change, controllers/Product.js and Search.js are unaffected.
 */

// A pipeline-style URL's last path segment, e.g. 'Product-Show'. SFRA's
// SEO-friendly URLs (/boots/mens-work-boot.html, /womens-western/) do NOT
// match, which is the point - see resolveFragmentUrl.
var CONTROLLER_ROUTE_SEGMENT = /^[A-Z][A-Za-z0-9]*-[A-Za-z0-9]+$/;

function buildQuery(params) {
    return Object.keys(params || {})
        .filter(function (key) { return params[key]; })
        .map(function (key) { return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]); })
        .join('&');
}

/**
 * Resolves the fragment endpoint's URL, in order of trustworthiness:
 *
 * 1. A server-rendered base URL on the page
 *    (`[data-personalized-fragment-base]`, holding a URLUtils-generated
 *    controller URL). This is the ONLY fully reliable source, because only
 *    the server knows the site/locale prefix. controllers/Product.js and
 *    controllers/Search.js already compute exactly this value into
 *    viewData (`personalizedStripUrl` / `personalizedRailUrl`); a one-line
 *    base-cartridge template change to emit it as this attribute is all
 *    that's needed to switch this module onto it - no change here.
 * 2. Derivation from the current path, ONLY when the current page is
 *    itself on a pipeline-style controller URL whose last segment looks
 *    like a route (.../Product-Show → .../Product-PersonalizedStrip).
 *
 * Anything else - which includes every SEO-friendly storefront URL, i.e.
 * how real PDP and Category pages are served - returns null and the
 * fragment is skipped. An earlier version derived unconditionally, which
 * on /boots/mens-work-boot.html produced /boots/Product-PersonalizedStrip:
 * a 404 the shopper never sees but that silently disables personalization
 * on exactly the pages it was built for. Skipping is the honest failure
 * mode; requesting a URL we know is wrong is not.
 *
 * @param {string} controllerRoute - e.g. 'Product-PersonalizedStrip'
 * @param {Object} params - query params for the fragment request
 * @returns {string|null} the fragment URL, or null if it can't be resolved
 */
function resolveFragmentUrl(controllerRoute, params) {
    var query = buildQuery(params);
    var serverBase = $('[data-personalized-fragment-base]').data('personalized-fragment-base');

    if (serverBase) {
        var base = String(serverBase).replace(/\/+$/, '');
        return base + '/' + controllerRoute + (query ? '?' + query : '');
    }

    var match = window.location.pathname.match(/^(.*\/)([^/]+)$/);
    if (!match || !CONTROLLER_ROUTE_SEGMENT.test(match[2])) {
        return null;
    }

    return match[1] + controllerRoute + (query ? '?' + query : '');
}

/**
 * @param {string} controllerRoute - e.g. 'Product-PersonalizedStrip'
 * @param {Object} params - query params for the fragment request
 */
function fetchFragment(controllerRoute, params) {
    var $target = $('#maincontent');
    if (!$target.length) {
        return;
    }

    var url = resolveFragmentUrl(controllerRoute, params);
    if (!url) {
        return;
    }

    var $placeholder = $('<div class="personalized-fragment-placeholder" aria-hidden="true"></div>');
    $target.append($placeholder);

    $.ajax({
        url: url,
        method: 'GET',
        success: function (html) {
            if (html && html.trim()) {
                $placeholder.replaceWith(html);
            } else {
                $placeholder.remove();
            }
        },
        error: function () {
            $placeholder.remove();
        }
    });
}

module.exports = {
    fetchFragment: fetchFragment,
    // Exported for unit coverage of the URL-resolution rules above (the
    // SEO-friendly-URL case is the one that silently disabled this feature
    // before); not intended as a second entry point for callers.
    resolveFragmentUrl: resolveFragmentUrl
};
