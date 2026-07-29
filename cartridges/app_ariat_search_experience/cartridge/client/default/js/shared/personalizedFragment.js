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
 * 1. Derives the fragment controller's URL from the CURRENT page's own URL
 *    (swapping the last path segment - the controller-route - for the
 *    fragment's route, e.g. .../Product-Show → .../Product-PersonalizedStrip),
 *    reusing whatever site/locale prefix the current page is already on.
 *    This avoids needing a server-rendered URL exposed via the shell
 *    template's viewData.
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

function buildFragmentUrl(controllerRoute, params) {
    var match = window.location.pathname.match(/^(.*\/)[^/]+$/);
    var prefix = match ? match[1] : '/';
    var query = Object.keys(params || {})
        .filter(function (key) { return params[key]; })
        .map(function (key) { return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]); })
        .join('&');
    return prefix + controllerRoute + (query ? '?' + query : '');
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

    var $placeholder = $('<div class="personalized-fragment-placeholder" aria-hidden="true"></div>');
    $target.append($placeholder);

    $.ajax({
        url: buildFragmentUrl(controllerRoute, params),
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
    fetchFragment: fetchFragment
};
