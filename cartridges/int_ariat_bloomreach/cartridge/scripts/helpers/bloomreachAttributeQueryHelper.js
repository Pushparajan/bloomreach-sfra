'use strict';

/**
 * Shared fq-filter query builder, reused by Boot Finder (Results),
 * Work-JobLanding, and (for pure hard-filter lookups) the Comparison Tool.
 * Extracted into one module per the prompt's instruction not to duplicate
 * query-building logic between Boot Finder Q1 and Work-JobLanding.
 *
 * ASSUMPTION: Bloomreach Discovery's boost syntax is modeled here as
 * `field:value^weight` fq fragments (Solr-style boost), which is the common
 * shape for Bloomreach's Product Search API `fq`/boost params. If the real
 * integration uses a different boost mechanism (e.g. a separate `boost`
 * query param), only this module needs to change - no controller depends on
 * the fragment syntax directly.
 */

var bloomreachService = require('../services/bloomreachService');
var inventoryBuryHelper = require('./inventoryBuryHelper');
var logger = require('./bloomreachLogger');

var HARD_FILTER_WEIGHT = null; // null weight => hard fq, filters results out
var SOFT_BOOST_WEIGHT = 1.5; // near-match boost, does not exclude

/**
 * @param {string} field
 * @param {string|number} value
 * @param {number|null} weight - null for a hard (exclusionary) filter
 * @returns {string}
 */
function buildFragment(field, value, weight) {
    var clause = field + ':"' + String(value).replace(/"/g, '\\"') + '"';
    return weight ? clause + '^' + weight : clause;
}

/**
 * @param {Object} answers - map of attribute field name -> value (or
 *   {min, max} for range attributes)
 * @param {Object} [options]
 * @param {string[]} [options.hardFields] - fields in `answers` that must be
 *   applied as hard filters (e.g. resolved size/width) rather than boosts
 * @param {boolean} [options.applyBuryRule=true]
 * @returns {string[]} array of fq fragments
 */
function buildFilterQueries(answers, options) {
    var opts = options || {};
    var hardFields = opts.hardFields || [];
    var fragments = [];

    Object.keys(answers || {}).forEach(function (field) {
        var value = answers[field];
        if (value === undefined || value === null || value === '') {
            return;
        }
        var isHard = hardFields.indexOf(field) !== -1;
        if (value && typeof value === 'object' && ('min' in value || 'max' in value)) {
            var rangeMin = value.min !== undefined ? value.min : '*';
            var rangeMax = value.max !== undefined ? value.max : '*';
            var range = rangeMin + ' TO ' + rangeMax;
            fragments.push(field + ':[' + range + ']' + (isHard ? '' : '^' + SOFT_BOOST_WEIGHT));
        } else {
            fragments.push(buildFragment(field, value, isHard ? HARD_FILTER_WEIGHT : SOFT_BOOST_WEIGHT));
        }
    });

    if (opts.applyBuryRule !== false) {
        var buryFragment = inventoryBuryHelper.getBuryFilterQuery();
        if (buryFragment) {
            fragments.push(buryFragment);
        }
    }

    return fragments;
}

/**
 * Calls Bloomreach with attribute filters instead of free text - the shape
 * requested for Boot Finder / Work-JobLanding. Sorting follows the
 * bvRating/bvReviewCount feature-flag fallback described in the shared
 * attribute table.
 *
 * @param {Object} params
 * @param {Object} params.answers - attribute filters, see buildFilterQueries
 * @param {string[]} [params.hardFields]
 * @param {boolean} [params.reviewCountBoostEnabled]
 * @param {boolean} [params.salesRankTiebreakEnabled]
 * @param {number} [params.start]
 * @param {number} [params.rows]
 * @param {string} [params.userId] - logged-in shopper id (see
 *   helpers/bloomreachCustomerIdentity). ONLY Boot Finder passes this -
 *   Work-JobLanding must not, per the integration spec's exclusion of
 *   Landing Pages from personalization; omitting it (leaving undefined)
 *   is how a caller opts out, since bloomreachService drops undefined
 *   params before sending the request.
 * @param {string} feature - logging context, e.g. 'BootFinder', 'WorkJobLanding'
 * @returns {Object|null} parsed Bloomreach response, or null on failure
 */
function queryByAttributes(params, feature) {
    var fq = buildFilterQueries(params.answers, { hardFields: params.hardFields });
    var sortField = params.reviewCountBoostEnabled ? 'bvRating,bvReviewCount' : 'bvRating';
    if (params.salesRankTiebreakEnabled) {
        sortField += ',sales_rank_bucket';
    }

    var requestParams = {
        fq: fq.join(' AND '),
        sort: sortField + ' desc',
        start: params.start || 0,
        rows: params.rows || 24,
        user_id: params.userId
    };

    try {
        return bloomreachService.call(requestParams);
    } catch (e) {
        logger.logServiceFailure(feature, e, requestParams);
        return null;
    }
}

module.exports = {
    buildFilterQueries: buildFilterQueries,
    queryByAttributes: queryByAttributes
};
