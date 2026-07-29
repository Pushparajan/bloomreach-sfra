'use strict';

var personalizedFragment = require('../shared/personalizedFragment');

/**
 * R-38: fetches the PDP's 1:1-personalized "recommended with this" strip
 * client-side, after the cached PDP shell has already loaded. See
 * shared/personalizedFragment.js for the shared fetch/injection logic and
 * its documented placement ASSUMPTION.
 */
module.exports = {
    init: function () {
        var pid = new URLSearchParams(window.location.search).get('pid');
        if (!pid) {
            return;
        }
        personalizedFragment.fetchFragment('Product-PersonalizedStrip', { pid: pid });
    }
};
