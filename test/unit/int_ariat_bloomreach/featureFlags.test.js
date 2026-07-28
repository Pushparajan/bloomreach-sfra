'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();
var dwStubs = require('../../mocks/dwStubs');

var MODULE_PATH = '../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/featureFlags';

function load(customPreferences) {
    return proxyquire(MODULE_PATH, {
        'dw/system/Site': dwStubs.siteStub(customPreferences)
    });
}

describe('int_ariat_bloomreach/helpers/featureFlags', function () {
    it('returns true only when the mapped preference is exactly true', function () {
        var featureFlags = load({ finderJobTypeEnabled: true, finderWaterproofQuestionEnabled: false });
        assert.isTrue(featureFlags.isEnabled('JOB_TYPE'));
        assert.isFalse(featureFlags.isEnabled('WATERPROOF_QUESTION'));
    });

    it('treats an unset preference as off (safe default for not-yet-live attributes)', function () {
        var featureFlags = load({});
        assert.isFalse(featureFlags.isEnabled('SAFETY_SPEC_REFINEMENT'));
        assert.isFalse(featureFlags.isEnabled('LOOMI_ENABLED'));
    });

    it('throws on an unknown flag key rather than silently returning false', function () {
        var featureFlags = load({});
        assert.throws(function () { featureFlags.isEnabled('NOT_A_REAL_FLAG'); }, /Unknown Bloomreach feature flag/);
    });
});
