'use strict';

/**
 * Lets Boot Finder and the Comparison Tool reuse a pre-generated Thematic
 * Page's product set instead of issuing a live Bloomreach query, when that
 * page's data can stand in for what the caller needs (see jobs/
 * GenerateThematicPages, which is where the data comes from).
 *
 * Two entry points, one per caller:
 *   - findDocs(answers): Boot Finder. Deliberately narrow - only reused when
 *     job_type/toe_shape/safety_specs are the ONLY answers present, since a
 *     thematic page's product set is hard-filtered to just those three
 *     fields and would silently drop a shopper's other selections (shaft
 *     height, waterproof, insulation) if reused for a broader answer set.
 *   - findDocsByCombinationKey(combinationKey, vgIds): the Comparison Tool.
 *     The client already knows which thematic page it's comparing from (see
 *     GenerateThematicPages's data-theme-key), so this looks the page up
 *     directly rather than re-deriving it from answers.
 *
 * Both callers keep their own live query as the fallback for every case
 * this module returns null for.
 */

var ContentMgr = require('dw/content/ContentMgr');
var Logger = require('dw/system/Logger');
var combinations = require('./thematicPageCombinations');
var constants = require('./bloomreachConstants');
var identity = require('./bloomreachIdentity');

var log = Logger.getLogger('bloomreach', 'thematicPageLookup');
var ATTR = constants.ATTRIBUTES;
var COMBO_FIELDS = [ATTR.JOB_TYPE, ATTR.TOE_SHAPE, ATTR.SAFETY_SPECS];

function isReusable(answers) {
    return Object.keys(answers || {}).every(function (field) {
        return COMBO_FIELDS.indexOf(field) !== -1;
    });
}

/**
 * Per Bloomreach's documented Thematic Page error handling (zero matching
 * products must trigger the fallback path, never render as a valid empty
 * result - https://documentation.bloomreach.com/discovery/reference/
 * error-handling-for-the-thematic-api), an empty or malformed stored product
 * set is treated as "not available" here, not as a valid empty match. This
 * is also why GenerateThematicPages takes a zero-product combination
 * offline rather than publishing an empty page - this is the second,
 * defense-in-depth guard against ever surfacing "zero products" as if it
 * were a successful result.
 *
 * @param {string} combinationKey
 * @returns {Object[]|null} the online content asset's stored raw Bloomreach
 *   hits for this combination, or null if the page/data isn't available
 */
function getStoredDocs(combinationKey) {
    var content = ContentMgr.getContent('work-' + combinationKey);
    if (!content || !content.online || !content.custom.productData) {
        return null;
    }

    var docs;
    try {
        docs = JSON.parse(content.custom.productData);
    } catch (e) {
        log.warn('Could not parse stored productData for {0}: {1}', 'work-' + combinationKey, e.message);
        return null;
    }

    return Array.isArray(docs) && docs.length > 0 ? docs : null;
}

/**
 * @param {Object} answers - resolved Boot Finder answers (attribute field -> value)
 * @returns {Object[]|null} raw Bloomreach hits from the matching online
 *   thematic page, or null if not eligible or no online match exists
 */
function findDocs(answers) {
    if (!isReusable(answers) || !answers[ATTR.JOB_TYPE]) {
        return null; // job_type is the combination matrix's mandatory key
    }

    var jobType = answers[ATTR.JOB_TYPE];
    var toeShape = answers[ATTR.TOE_SHAPE] || null;
    var safetySpec = answers[ATTR.SAFETY_SPECS] || null;

    var combo = combinations.getEnabledCombinations().filter(function (c) {
        return c.jobType === jobType
            && (c.toeShape || null) === toeShape
            && (c.safetySpec || null) === safetySpec;
    })[0];

    return combo ? getStoredDocs(combo.key) : null;
}

/**
 * Returns docs in the SAME order as vgIds (matching the shopper's
 * add/remove order), and only when every requested id is present - a
 * partial match still falls back to a live query rather than silently
 * showing an incomplete comparison (e.g. a shopper added an item from
 * elsewhere on the site after landing via a thematic page).
 *
 * @param {string} combinationKey
 * @param {string[]} vgIds
 * @returns {Object[]|null}
 */
function findDocsByCombinationKey(combinationKey, vgIds) {
    if (!combinationKey || !vgIds || !vgIds.length) {
        return null;
    }

    var docs = getStoredDocs(combinationKey);
    if (!docs) {
        return null;
    }

    var docsByVgId = {};
    docs.forEach(function (doc) {
        var ids = identity.fromBloomreachHit(doc);
        if (ids.vgId) {
            docsByVgId[ids.vgId] = doc;
        }
    });

    var matched = vgIds.map(function (vgId) { return docsByVgId[vgId]; }).filter(Boolean);
    return matched.length === vgIds.length ? matched : null;
}

module.exports = {
    findDocs: findDocs,
    findDocsByCombinationKey: findDocsByCombinationKey
};
