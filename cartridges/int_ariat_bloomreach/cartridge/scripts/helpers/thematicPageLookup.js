'use strict';

/**
 * Lets Boot Finder reuse a pre-generated Thematic Page's product set instead
 * of issuing its own live Bloomreach query, when the shopper's answers
 * reduce exactly to a combination the merchandising matrix already covers
 * (see jobs/GenerateThematicPages) and that page is currently online.
 *
 * Deliberately narrow: only reused when job_type/toe_shape/safety_specs are
 * the ONLY answers present, since a thematic page's product set is
 * hard-filtered to just those three fields and would silently drop a
 * shopper's other selections (shaft height, waterproof, insulation) if
 * reused for a broader answer set. Boot Finder keeps its own live,
 * soft-boosted query as the fallback for every other case.
 */

var ContentMgr = require('dw/content/ContentMgr');
var Logger = require('dw/system/Logger');
var combinations = require('./thematicPageCombinations');
var constants = require('./bloomreachConstants');

var log = Logger.getLogger('bloomreach', 'thematicPageLookup');
var ATTR = constants.ATTRIBUTES;
var COMBO_FIELDS = [ATTR.JOB_TYPE, ATTR.TOE_SHAPE, ATTR.SAFETY_SPECS];

function isReusable(answers) {
    return Object.keys(answers || {}).every(function (field) {
        return COMBO_FIELDS.indexOf(field) !== -1;
    });
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

    if (!combo) {
        return null;
    }

    var content = ContentMgr.getContent('work-' + combo.key);
    if (!content || !content.online || !content.custom.productData) {
        return null;
    }

    try {
        return JSON.parse(content.custom.productData);
    } catch (e) {
        log.warn('Could not parse stored productData for {0}: {1}', 'work-' + combo.key, e.message);
        return null;
    }
}

module.exports = {
    findDocs: findDocs
};
