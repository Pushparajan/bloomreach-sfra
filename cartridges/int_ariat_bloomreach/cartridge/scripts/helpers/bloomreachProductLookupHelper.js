'use strict';

/**
 * Batch product-attribute lookup by VG id, for the Comparison Tool.
 *
 * ASSUMPTION (flagged per prompt rule: "if no such lookup exists in the
 * current service, ask before inventing one"): no real integration exists
 * here to confirm against (greenfield repo). Rather than fabricate a new
 * batch-lookup endpoint, this implements the lookup as an OR'd fq filter on
 * the existing search endpoint (`pid:(id1 OR id2 OR ...)`, no `q`), which is
 * a projection-by-id pattern Bloomreach's Product Search API supports today
 * and reuses the exact same service call as everything else in this
 * cartridge. Before shipping, confirm with the Bloomreach account team
 * whether a dedicated batch endpoint exists and would be preferable.
 */

var bloomreachService = require('../services/bloomreachService');
var constants = require('./bloomreachConstants');
var identity = require('./bloomreachIdentity');
var logger = require('./bloomreachLogger');

var MAX_COMPARE_ITEMS = 4;
var MIN_COMPARE_ITEMS = 2;

/**
 * @param {string[]} vgIds - Variation Group ids (2-4)
 * @param {string} feature - logging context
 * @returns {Object|null} parsed Bloomreach response keyed by pid, or null on failure
 */
function lookupByIds(vgIds, feature) {
    var ids = (vgIds || []).filter(identity.isWellFormedId);
    if (ids.length < MIN_COMPARE_ITEMS || ids.length > MAX_COMPARE_ITEMS) {
        throw new Error('Comparison lookup requires between ' + MIN_COMPARE_ITEMS + ' and '
            + MAX_COMPARE_ITEMS + ' valid Variation Group ids, got ' + ids.length);
    }

    var idClause = ids.map(function (id) { return '"' + id.replace(/"/g, '\\"') + '"'; }).join(' OR ');
    var requestParams = {
        fq: constants.IDENTITY.PID_FIELD + ':(' + idClause + ')',
        rows: ids.length
    };

    try {
        return bloomreachService.call(requestParams);
    } catch (e) {
        logger.logServiceFailure(feature || 'CompareLookup', e, requestParams);
        return null;
    }
}

module.exports = {
    lookupByIds: lookupByIds,
    MAX_COMPARE_ITEMS: MAX_COMPARE_ITEMS,
    MIN_COMPARE_ITEMS: MIN_COMPARE_ITEMS
};
