'use strict';

/**
 * R-38: fetches the 1:1-personalized (or segment-level fallback) content
 * strip for Work-JobLanding client-side, after the cached shell has already
 * loaded - so the shell's own page-cache eligibility (cache.applyDefaultCache,
 * see controllers/Work.js) is completely untouched by this.
 *
 * Default (client-fetch) integration: Work-PersonalizedStrip is a standalone
 * controller endpoint, so this can be swapped for an SFRA remote include
 * later without changing the endpoint itself, if server-rendering turns out
 * to be preferable.
 *
 * Failure handling: if the fetch itself fails (network error, non-2xx), the
 * skeleton placeholder is simply removed rather than left stuck loading or
 * visibly broken - the shell's own hero/copy/product grid render fully
 * independently of this fragment either way. The FAR more common case (flag
 * off, guest, or a Bloomreach-side personalization failure) is handled
 * entirely server-side in one request - the response is still HTML success,
 * just the existing segment-level content zone instead of a personalized one
 * - so this client-side error branch is only reached for a real fragment
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
