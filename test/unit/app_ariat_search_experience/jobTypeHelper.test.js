'use strict';

var assert = require('chai').assert;
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();

var MODULE_PATH = '../../../cartridges/app_ariat_search_experience/cartridge/scripts/shared/jobTypeHelper';
var CONSTANTS = require('../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/bloomreachConstants');

function load(jobTypeEnabled) {
    return proxyquire(MODULE_PATH, {
        '*/cartridge/scripts/helpers/featureFlags': { isEnabled: sinon.stub().returns(jobTypeEnabled) },
        '*/cartridge/scripts/helpers/bloomreachConstants': CONSTANTS
    });
}

describe('app_ariat_search_experience/shared/jobTypeHelper (shared by Boot Finder Q1 and Work-JobLanding)', function () {
    it('happy path: returns the job type list when finder.jobType.enabled is on', function () {
        var mod = load(true);
        assert.isAbove(mod.getJobTypes().length, 0);
    });

    it('flag-off: returns an empty list so neither Boot Finder Q1 nor Work-JobLanding render a dead question', function () {
        var mod = load(false);
        assert.deepEqual(mod.getJobTypes(), []);
    });

    it('getBySlug resolves a known slug only when the flag is on', function () {
        assert.equal(load(true).getBySlug('construction').value, 'construction');
        assert.isNull(load(false).getBySlug('construction'));
    });

    it('getBySlug returns null for an unknown slug', function () {
        assert.isNull(load(true).getBySlug('not-a-real-trade'));
    });

    it('toAnswerFilter keys the value under the Bloomreach job_type field', function () {
        var mod = load(true);
        var filter = mod.toAnswerFilter('electrical');
        assert.deepEqual(filter, { job_type: 'electrical' });
    });
});
