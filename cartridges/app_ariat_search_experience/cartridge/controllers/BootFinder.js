'use strict';

var server = require('server');
var interactiveCache = require('*/cartridge/scripts/middleware/interactiveCache');
var questionConfig = require('*/cartridge/scripts/bootFinder/bootFinderQuestionConfig');
var rationaleChipBuilder = require('*/cartridge/scripts/bootFinder/rationaleChipBuilder');
var sizeAvailabilityHelper = require('*/cartridge/scripts/bootFinder/sizeAvailabilityHelper');
var attributeQueryHelper = require('*/cartridge/scripts/helpers/bloomreachAttributeQueryHelper');
var identity = require('*/cartridge/scripts/helpers/bloomreachIdentity');
var featureFlags = require('*/cartridge/scripts/helpers/featureFlags');
var bloomreachLogger = require('*/cartridge/scripts/helpers/bloomreachLogger');

var FEATURE = 'BootFinder';

/**
 * Renders the question/result shell. No answers yet - the client drives the
 * state machine from here via AJAX calls to Results, per "prefer this,
 * fewer round trips."
 */
server.get('Show', interactiveCache.applyNoCache, function (req, res, next) {
    res.render('bootfinder/show', {
        questions: questionConfig.getActiveQuestions(),
        shaftHeight: questionConfig.resolveShaftHeightField()
    });
    next();
});

/**
 * AJAX endpoint the client calls on the final step or on "show results now."
 * Accepts accumulated answers as a JSON-encoded request param so arbitrary
 * combinations of skippable questions don't need bespoke param names.
 */
server.get('Results', interactiveCache.applyNoCache, function (req, res, next) {
    var rawAnswers = {};
    try {
        rawAnswers = req.querystring.answers ? JSON.parse(req.querystring.answers) : {};
    } catch (e) {
        bloomreachLogger.logWarn(FEATURE, 'Could not parse answers param', { raw: req.querystring.answers });
        rawAnswers = {};
    }

    var activeQuestions = questionConfig.getActiveQuestions();
    var activeFields = activeQuestions.map(function (q) { return q.field; }).filter(Boolean);

    // Only forward answers whose question is still active - protects against
    // a stale client that answered a question whose flag was flipped off
    // mid-session.
    var answers = {};
    Object.keys(rawAnswers).forEach(function (field) {
        if (activeFields.indexOf(field) !== -1) {
            answers[field] = rawAnswers[field];
        }
    });

    var shaftHeightAnswer = rawAnswers.shaftHeight;
    if (shaftHeightAnswer) {
        var shaftHeightField = questionConfig.resolveShaftHeightField();
        answers[shaftHeightField.field] = shaftHeightAnswer;
    }

    var bloomreachResponse = attributeQueryHelper.queryByAttributes({
        answers: answers,
        reviewCountBoostEnabled: featureFlags.isEnabled('REVIEW_COUNT_BOOST'),
        salesRankTiebreakEnabled: featureFlags.isEnabled('SALES_RANK_TIEBREAK'),
        rows: 24
    }, FEATURE);

    if (!bloomreachResponse) {
        res.setStatusCode(502);
        res.render('bootfinder/resultsError');
        next();
        return;
    }

    var docs = (bloomreachResponse.response && bloomreachResponse.response.docs) || [];
    var vgIds = docs.map(function (doc) { return identity.fromBloomreachHit(doc).vgId; }).filter(Boolean);
    var availableVgIds = sizeAvailabilityHelper.filterByAvailability(
        vgIds,
        rawAnswers.size,
        rawAnswers.width
    );
    var availableSet = availableVgIds.reduce(function (acc, id) { acc[id] = true; return acc; }, {});

    var results = docs
        .filter(function (doc) {
            var vgId = identity.fromBloomreachHit(doc).vgId;
            return vgId && availableSet[vgId];
        })
        .map(function (doc) {
            var ids = identity.fromBloomreachHit(doc);
            return {
                vgId: ids.vgId,
                name: doc.title,
                image: doc.thumb_image,
                price: doc.price,
                bvRating: doc.bvRating,
                bvReviewCount: doc.bvReviewCount,
                chips: rationaleChipBuilder.buildChips(answers, doc)
            };
        });

    res.render('bootfinder/resultsGrid', { results: results });
    next();
});

module.exports = server.exports();
