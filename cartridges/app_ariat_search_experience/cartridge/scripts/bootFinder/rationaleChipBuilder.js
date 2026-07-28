'use strict';

/**
 * Builds "Matches: Electrical Hazard - 8-inch - Composite Toe" rationale
 * chips: one per answered question that a given result actually satisfies.
 * Never emits a chip for a question tied to a disabled feature flag, since
 * bootFinderQuestionConfig.getActiveQuestions() already excludes those
 * questions from `answers` upstream.
 */

var constants = require('*/cartridge/scripts/helpers/bloomreachConstants');

var CHIP_LABEL_BUILDERS = {};
CHIP_LABEL_BUILDERS[constants.ATTRIBUTES.JOB_TYPE] = function (value) { return value + ' Ready'; };
CHIP_LABEL_BUILDERS[constants.ATTRIBUTES.SAFETY_TOE] = function (value) { return value + ' Toe'; };
CHIP_LABEL_BUILDERS[constants.ATTRIBUTES.TOE_SHAPE] = function (value) { return value + ' Toe Shape'; };
CHIP_LABEL_BUILDERS[constants.ATTRIBUTES.SHAFT_HEIGHT] = function (value) { return value; };
CHIP_LABEL_BUILDERS[constants.ATTRIBUTES.SHAFT_HEIGHT_IN] = function (value) { return value + '" Shaft'; };
CHIP_LABEL_BUILDERS[constants.ATTRIBUTES.FEATURE_WATERPROOF] = function () { return 'Waterproof'; };
CHIP_LABEL_BUILDERS[constants.ATTRIBUTES.WARMTH_RATING] = function (value) { return value + ' Insulation'; };
CHIP_LABEL_BUILDERS[constants.ATTRIBUTES.SAFETY_SPECS] = function (value) { return value; };

function valuesMatch(answerValue, hitValue) {
    if (hitValue === undefined || hitValue === null) {
        return false;
    }
    if (answerValue && typeof answerValue === 'object' && ('min' in answerValue || 'max' in answerValue)) {
        var numeric = Number(hitValue);
        var min = answerValue.min !== undefined ? Number(answerValue.min) : -Infinity;
        var max = answerValue.max !== undefined ? Number(answerValue.max) : Infinity;
        return numeric >= min && numeric <= max;
    }
    if (Array.isArray(hitValue)) {
        return hitValue.indexOf(answerValue) !== -1;
    }
    return String(hitValue) === String(answerValue);
}

/**
 * @param {Object} answers - field -> answer value used to build the query
 * @param {Object} hit - a single raw Bloomreach result record
 * @returns {{field: string, label: string}[]}
 */
function buildChips(answers, hit) {
    var chips = [];
    Object.keys(answers || {}).forEach(function (field) {
        var builder = CHIP_LABEL_BUILDERS[field];
        if (!builder) {
            return;
        }
        var hitValue = hit[field];
        if (valuesMatch(answers[field], hitValue)) {
            chips.push({ field: field, label: builder(Array.isArray(hitValue) ? hitValue[0] : hitValue) });
        }
    });
    return chips;
}

module.exports = {
    buildChips: buildChips
};
