'use strict';

/**
 * SFCC Job Framework step (custom.GenerateThematicPages, see steptypes.json).
 * Batch/generation task, NOT a live controller: reads the merchandiser-
 * editable ThematicPageCombination custom object matrix, queries Bloomreach
 * per combination, and creates/updates/hides a Content asset per row.
 *
 * ASSUMPTION: "static/cached content page" is modeled as an SFCC Content
 * asset (dw.content.ContentMgr) rather than a Page Designer page, so the
 * generated body can hold schema.org JSON-LD directly. Sitemap refresh is
 * intentionally NOT reimplemented here - this step only keeps
 * Content.onlineFlag accurate (online for combos with in-stock products,
 * offline otherwise) and assumes it runs immediately before the platform's
 * existing "Generate Sitemap" job step in the same job chain, so sitemap
 * output picks up the online/offline state on the same run.
 */

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var ContentMgr = require('dw/content/ContentMgr');
var Transaction = require('dw/system/Transaction');
var Status = require('dw/system/Status');
var Logger = require('dw/system/Logger');

var attributeQueryHelper = require('../helpers/bloomreachAttributeQueryHelper');
var identity = require('../helpers/bloomreachIdentity');
var constants = require('../helpers/bloomreachConstants');
var featureFlags = require('../helpers/featureFlags');

var log = Logger.getLogger('bloomreach', 'GenerateThematicPages');
var FEATURE = 'ThematicPages';
var CONTENT_FOLDER_ID = 'work-thematic-pages';

function getCombinations() {
    var iter = CustomObjectMgr.getAllCustomObjects('ThematicPageCombination');
    var combos = [];
    try {
        while (iter.hasNext()) {
            var co = iter.next();
            if (co.custom.enabled) {
                combos.push({
                    key: co.custom.combinationKey,
                    jobType: co.custom.jobType,
                    safetySpec: co.custom.safetySpec,
                    toeShape: co.custom.toeShape
                });
            }
        }
    } finally {
        iter.close();
    }
    return combos;
}

/**
 * R-21 gate: safety_specs[] combinations are skipped entirely while the
 * upstream feed fix is in flight, regardless of what the matrix contains -
 * protects against stale/corrupted merchandising rows generating bad pages.
 */
function isEligible(combo) {
    if (combo.safetySpec && !featureFlags.isEnabled('SAFETY_SPEC_REFINEMENT')) {
        log.warn('Skipping combination {0}: safety_specs gate (finder.safetySpecRefinement.enabled) is off', combo.key);
        return false;
    }
    return true;
}

function buildAnswers(combo) {
    var answers = {};
    answers[constants.ATTRIBUTES.JOB_TYPE] = combo.jobType;
    if (combo.toeShape) {
        answers[constants.ATTRIBUTES.TOE_SHAPE] = combo.toeShape;
    }
    if (combo.safetySpec) {
        answers[constants.ATTRIBUTES.SAFETY_SPECS] = combo.safetySpec;
    }
    return answers;
}

function buildSchemaOrgMarkup(combo, docs) {
    var itemListElement = docs.map(function (doc, index) {
        var ids = identity.fromBloomreachHit(doc);
        return {
            '@type': 'ListItem',
            position: index + 1,
            url: '/on/demandware.store/Sites-Ariat-Site/default/Product-Show?pid=' + ids.vgId,
            name: doc.title
        };
    });
    return JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: [combo.jobType, combo.safetySpec, combo.toeShape].filter(Boolean).join(' '),
        itemListElement: itemListElement
    });
}

function upsertContent(combo, docs, dryRun) {
    var contentId = 'work-' + combo.key;
    var hasProducts = docs.length > 0;

    if (dryRun) {
        log.info('[DryRun] {0}: would set online={1}, {2} products', contentId, hasProducts, docs.length);
        return;
    }

    Transaction.wrap(function () {
        var content = ContentMgr.getContent(contentId);
        if (!content) {
            var folder = ContentMgr.getFolder(CONTENT_FOLDER_ID);
            if (!folder) {
                log.error('Content folder {0} does not exist - skipping {1}', CONTENT_FOLDER_ID, contentId);
                return;
            }
            content = ContentMgr.createContent(contentId);
            folder.assignContent(content);
        }

        // Hide pages whose combination now returns zero in-stock products,
        // to protect SEO authority - never leave a dead page live.
        content.setOnline(hasProducts);

        if (hasProducts) {
            content.custom.body = buildSchemaOrgMarkup(combo, docs);
            content.custom.productCount = docs.length;
        }
    });
}

/**
 * @param {Object} parameters - job step parameters (DryRun)
 * @returns {dw.system.Status}
 */
function execute(parameters) {
    var dryRun = parameters.DryRun === true || parameters.DryRun === 'true';
    var combinations = getCombinations();
    var processed = 0;
    var errors = 0;

    combinations.filter(isEligible).forEach(function (combo) {
        try {
            var hardFields = [
                constants.ATTRIBUTES.JOB_TYPE,
                constants.ATTRIBUTES.TOE_SHAPE,
                constants.ATTRIBUTES.SAFETY_SPECS
            ];
            var response = attributeQueryHelper.queryByAttributes({
                answers: buildAnswers(combo),
                hardFields: hardFields,
                rows: 48
            }, FEATURE);

            if (!response) {
                errors += 1;
                return;
            }

            var docs = (response.response && response.response.docs) || [];
            upsertContent(combo, docs, dryRun);
            processed += 1;
        } catch (e) {
            errors += 1;
            log.error('Failed processing combination {0}: {1}', combo.key, e.message);
        }
    });

    log.info('GenerateThematicPages complete: {0} processed, {1} errors, dryRun={2}', processed, errors, dryRun);

    return errors > 0 && processed === 0
        ? new Status(Status.ERROR, 'ERROR', 'All combinations failed')
        : new Status(Status.OK, 'OK', processed + ' combinations processed, ' + errors + ' errors');
}

module.exports = {
    execute: execute
};
