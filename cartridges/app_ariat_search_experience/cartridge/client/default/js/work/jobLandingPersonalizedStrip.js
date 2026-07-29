'use strict';

/**
 * R-38: fetches a 1:1-personalized (or non-personalized fallback) content
 * fragment client-side, after the cached shell/page has already loaded -
 * so the shell's own page-cache eligibility is completely untouched.
 *
 * Deliberately generic: this is a plain [data-personalized-strip-url]
 * attribute selector, not scoped to Work-JobLanding specifically, so it
 * also serves the Thematic Pages personalized strip
 * (jobs/GenerateThematicPages.js's buildPersonalizedStripPlaceholder,
 * fetched from controllers/ThematicPage.js's PersonalizedStrip route) with
 * no changes needed here - each page only ever renders one such
 * placeholder, so a single shared module covers both without conflict.
 *
 * Default (client-fetch) integration: each fragment is a standalone
 * controller endpoint, so any of them can be swapped for an SFRA remote
 * include later without changing the endpoint itself, if server-rendering
 * turns out to be preferable.
 *
 * Failure handling: if the fetch itself fails (network error, non-2xx), the
 * skeleton placeholder is simply removed rather than left stuck loading or
 * visibly broken - the shell/page's own content renders fully independently
 * of this fragment either way. The FAR more common case (flag off, guest,
 * or a Bloomreach-side personalization failure) is handled entirely
 * server-side in one request - the response is still HTML success, just
 * the fallback content (or nothing) instead of a personalized one - so
 * this client-side error branch is only reached for a real fragment
 * request/server failure.
 */
module.exports = {
    init: function () {
        var $placeholder = $('[data-personalized-strip-url]');
        if (!$placeholder.length) {
            return;
        }

        $.ajax({
            url: $placeholder.data('personalized-strip-url'),
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
};
