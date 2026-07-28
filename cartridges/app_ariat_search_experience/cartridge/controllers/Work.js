'use strict';

var server = require('server');
var cache = require('*/cartridge/scripts/middleware/cache');
var jobTypeHelper = require('*/cartridge/scripts/shared/jobTypeHelper');
var attributeQueryHelper = require('*/cartridge/scripts/helpers/bloomreachAttributeQueryHelper');
var identity = require('*/cartridge/scripts/helpers/bloomreachIdentity');
var featureFlags = require('*/cartridge/scripts/helpers/featureFlags');
var PageMgr = require('dw/experience/PageMgr');

var FEATURE = 'WorkJobLanding';

/**
 * /work/{jobType} - resolves a job-type slug to a Bloomreach category-widget
 * query. Uses the SAME query-building helper Boot Finder Q1 uses
 * (bloomreachAttributeQueryHelper + jobTypeHelper) rather than duplicating
 * filter-building logic, per spec.
 *
 * Caching: standard SFRA page-cache pragma (this route is content-weighted
 * and may cache normally, unlike Boot Finder/Compare) - see
 * cache.applyDefaultCache below, NOT the interactiveCache middleware used by
 * the two stateful features.
 */
server.get('JobLanding', cache.applyDefaultCache, function (req, res, next) {
    var jobType = jobTypeHelper.getBySlug(req.params.jobType || req.querystring.jobType);

    if (!featureFlags.isEnabled('JOB_TYPE') || !jobType) {
        res.render('work/jobLandingNotFound');
        next();
        return;
    }

    var bloomreachResponse = attributeQueryHelper.queryByAttributes({
        answers: jobTypeHelper.toAnswerFilter(jobType.value),
        hardFields: [], // soft-boosted, same shape as Boot Finder Q1 rather than a hard filter-only page
        reviewCountBoostEnabled: featureFlags.isEnabled('REVIEW_COUNT_BOOST'),
        salesRankTiebreakEnabled: featureFlags.isEnabled('SALES_RANK_TIEBREAK'),
        rows: 30
    }, FEATURE);

    var docs = bloomreachResponse && bloomreachResponse.response ? bloomreachResponse.response.docs : [];
    var products = (docs || []).map(function (doc) {
        var ids = identity.fromBloomreachHit(doc);
        return {
            vgId: ids.vgId,
            name: doc.title,
            image: doc.thumb_image,
            price: doc.price
        };
    });

    // Wires into the site's existing Page Designer content-zone / content-slot
    // mechanism already used for browse-cookie segments (ASSUMPTION: modeled
    // via dw.experience.PageMgr page-designer lookup by a per-jobtype page
    // ID convention; no real mechanism was available to inspect).
    var contentPage = PageMgr.getPage('work-joblanding-' + jobType.slug);

    res.render('work/jobLanding', {
        jobType: jobType,
        products: products,
        contentPage: contentPage,
        serviceFailed: !bloomreachResponse
    });
    next();
});

module.exports = server.exports();
