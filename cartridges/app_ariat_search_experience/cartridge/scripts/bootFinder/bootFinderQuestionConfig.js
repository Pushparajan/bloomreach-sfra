'use strict';

/**
 * Ordered Boot Finder question flow. Shared source of truth for both the
 * server (BootFinder-Results query building / rationale chips) and the
 * client (client/default/js/bootFinder/bootFinder.js state machine), so the
 * two never drift. Flag-gated questions are simply omitted from
 * getActiveQuestions() - the client never renders a question tied to a
 * disabled flag, satisfying "a shopper must never see a question that
 * silently does nothing."
 */

var constants = require('*/cartridge/scripts/helpers/bloomreachConstants');
var featureFlags = require('*/cartridge/scripts/helpers/featureFlags');

var ATTR = constants.ATTRIBUTES;

// R-21 gate: safety_specs[] disabled by default until the upstream feed fix lands.
var ALL_QUESTIONS = [
    { id: 'jobType', field: ATTR.JOB_TYPE, flag: 'JOB_TYPE', type: 'single-select', chipLabel: 'Job Match' },
    { id: 'safetyToe', field: ATTR.SAFETY_TOE, flag: null, type: 'single-select', chipLabel: null },
    { id: 'toeShape', field: ATTR.TOE_SHAPE, flag: null, type: 'single-select', chipLabel: null },
    { id: 'shaftHeight', field: null, flag: null, type: 'shaft-height', chipLabel: null },
    { id: 'sizeWidth', field: null, flag: null, type: 'variant', chipLabel: null },
    {
        id: 'waterproof',
        field: ATTR.FEATURE_WATERPROOF,
        flag: 'WATERPROOF_QUESTION',
        type: 'boolean',
        chipLabel: 'Waterproof'
    },
    {
        id: 'insulation',
        field: ATTR.WARMTH_RATING,
        flag: 'INSULATION_QUESTION',
        type: 'single-select',
        chipLabel: null
    },
    {
        id: 'safetySpec',
        field: ATTR.SAFETY_SPECS,
        flag: 'SAFETY_SPEC_REFINEMENT',
        type: 'multi-select',
        chipLabel: null
    }
];

/**
 * @returns {Object[]} the subset of ALL_QUESTIONS whose flag (if any) is on
 */
function getActiveQuestions() {
    return ALL_QUESTIONS.filter(function (question) {
        return !question.flag || featureFlags.isEnabled(question.flag);
    });
}

/**
 * Shaft height resolves to a numeric range field when
 * finder.shaftHeightRange.enabled is on, else falls back to string-match on
 * the live Shaft_Height attribute.
 *
 * @returns {{field: string, mode: 'range'|'string'}}
 */
function resolveShaftHeightField() {
    if (featureFlags.isEnabled('SHAFT_HEIGHT_RANGE')) {
        return { field: constants.ATTRIBUTES.SHAFT_HEIGHT_IN, mode: 'range' };
    }
    return { field: constants.ATTRIBUTES.SHAFT_HEIGHT, mode: 'string' };
}

module.exports = {
    ALL_QUESTIONS: ALL_QUESTIONS,
    getActiveQuestions: getActiveQuestions,
    resolveShaftHeightField: resolveShaftHeightField
};
