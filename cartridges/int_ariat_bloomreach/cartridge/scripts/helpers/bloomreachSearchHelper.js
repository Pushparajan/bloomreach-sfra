'use strict';

/**
 * Baseline search/suggest helper - stands in for the site's existing
 * Bloomreach search integration (see top-of-file assumption in
 * services/bloomreachService.js). New features must call THIS module's
 * `searchByFilters` (or the sibling attribute/product-lookup helpers that
 * share its request-building shape) rather than talking to
 * services/bloomreachService.js directly, matching the "reuse the existing
 * controller-call pattern, parameterized by attribute filters" requirement.
 */

var bloomreachService = require('../services/bloomreachService');

/**
 * Existing free-text search call shape (unchanged - shown here only so the
 * fq-based helpers below can be seen extending it rather than diverging).
 *
 * @param {string} query - free text search string
 * @param {Object} [options]
 * @returns {Object} parsed Bloomreach response
 */
function search(query, options) {
    var params = Object.assign({
        q: query,
        search_type: 'keyword',
        start: (options && options.start) || 0,
        rows: (options && options.rows) || 24
    }, options && options.extraParams);
    return bloomreachService.call(params);
}

/**
 * Existing autosuggest call shape.
 *
 * @param {string} prefix
 * @returns {Object} parsed Bloomreach response
 */
function suggest(prefix) {
    return bloomreachService.call({
        q: prefix,
        request_type: 'suggest'
    });
}

module.exports = {
    search: search,
    suggest: suggest
};
