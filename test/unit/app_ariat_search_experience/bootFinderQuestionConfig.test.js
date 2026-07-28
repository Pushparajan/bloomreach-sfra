'use strict';

var assert = require('chai').assert;
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();

var MODULE_PATH = '../../../cartridges/app_ariat_search_experience/cartridge/scripts/bootFinder/bootFinderQuestionConfig';
var CONSTANTS = require('../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/bloomreachConstants');

function load(enabledFlags) {
    var isEnabled = sinon.stub().callsFake(function (key) {
        return (enabledFlags || []).indexOf(key) !== -1;
    });
    return proxyquire(MODULE_PATH, {
        '*/cartridge/scripts/helpers/bloomreachConstants': CONSTANTS,
        '*/cartridge/scripts/helpers/featureFlags': { isEnabled: isEnabled }
    });
}

describe('app_ariat_search_experience/bootFinder/bootFinderQuestionConfig', function () {
    it('happy path: with every flag on, all questions (incl. flag-gated ones) are active in defined order', function () {
        var mod = load(['JOB_TYPE', 'WATERPROOF_QUESTION', 'INSULATION_QUESTION', 'SAFETY_SPEC_REFINEMENT']);
        var ids = mod.getActiveQuestions().map(function (q) { return q.id; });
        assert.deepEqual(ids, ['jobType', 'safetyToe', 'toeShape', 'shaftHeight', 'sizeWidth', 'waterproof', 'insulation', 'safetySpec']);
    });

    it('flag-off: with no flags on, only the always-live questions remain (never a dead question)', function () {
        var mod = load([]);
        var ids = mod.getActiveQuestions().map(function (q) { return q.id; });
        assert.deepEqual(ids, ['safetyToe', 'toeShape', 'shaftHeight', 'sizeWidth']);
    });

    it('safety_specs question is off by default per R-21 (must default OFF)', function () {
        var mod = load(['JOB_TYPE']);
        var ids = mod.getActiveQuestions().map(function (q) { return q.id; });
        assert.notInclude(ids, 'safetySpec');
    });

    describe('resolveShaftHeightField', function () {
        it('uses the numeric range field when finder.shaftHeightRange.enabled is on', function () {
            var mod = load(['SHAFT_HEIGHT_RANGE']);
            assert.deepEqual(mod.resolveShaftHeightField(), { field: 'shaft_height_in', mode: 'range' });
        });

        it('falls back to the live string field when the flag is off', function () {
            var mod = load([]);
            assert.deepEqual(mod.resolveShaftHeightField(), { field: 'Shaft_Height', mode: 'string' });
        });
    });
});
