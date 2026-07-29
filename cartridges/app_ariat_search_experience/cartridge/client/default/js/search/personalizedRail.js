'use strict';

var personalizedFragment = require('../shared/personalizedFragment');

/**
 * R-38: fetches the Category page's 1:1-personalized "recommended for
 * you" rail client-side, after the cached Category shell has already
 * loaded. Only categories the server-side controller maps to a known job
 * type render anything (see controllers/Search.js) - every other category
 * still runs this fetch, but the fragment endpoint itself renders nothing
 * for them, so the placeholder collapses as a harmless no-op.
 */
module.exports = {
    init: function () {
        var cgid = new URLSearchParams(window.location.search).get('cgid');
        if (!cgid) {
            return;
        }
        personalizedFragment.fetchFragment('Search-PersonalizedRail', { cgid: cgid });
    }
};
