'use strict';

var assert = require('chai').assert;
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();

var MODULE_PATH = '../../../cartridges/app_ariat_search_experience/cartridge/scripts/compare/compareModel';
var CONSTANTS = require('../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/bloomreachConstants');
var identity = require('../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/bloomreachIdentity');

function load(enabledFlags) {
    var isEnabled = sinon.stub().callsFake(function (key) {
        return (enabledFlags || []).indexOf(key) !== -1;
    });
    return proxyquire(MODULE_PATH, {
        '*/cartridge/scripts/helpers/bloomreachConstants': CONSTANTS,
        '*/cartridge/scripts/helpers/bloomreachIdentity': identity,
        '*/cartridge/scripts/helpers/featureFlags': { isEnabled: isEnabled }
    });
}

describe('app_ariat_search_experience/compare/compareModel', function () {
    it('happy path: always-live rows appear regardless of flags', function () {
        var mod = load([]);
        var keys = mod.getActiveRows().map(function (r) { return r.key; });
        assert.include(keys, 'safetyToe');
        assert.include(keys, 'toeShape');
        assert.include(keys, 'shaftHeight');
        assert.include(keys, 'rating');
    });

    it('omits the waterproof/insulation/shaftHeightIn rows entirely when their flags are off (never a blank row)', function () {
        var mod = load([]);
        var keys = mod.getActiveRows().map(function (r) { return r.key; });
        assert.notInclude(keys, 'waterproof');
        assert.notInclude(keys, 'warmthRating');
        assert.notInclude(keys, 'shaftHeightIn');
    });

    it('includes those rows once their flags are on', function () {
        var mod = load(['WATERPROOF_QUESTION', 'INSULATION_QUESTION', 'SHAFT_HEIGHT_RANGE']);
        var keys = mod.getActiveRows().map(function (r) { return r.key; });
        assert.include(keys, 'waterproof');
        assert.include(keys, 'warmthRating');
        assert.include(keys, 'shaftHeightIn');
    });

    it('rating row falls back to bvRating-only when review-count-boost flag is off', function () {
        var mod = load([]);
        var ratingRow = mod.getActiveRows().filter(function (r) { return r.key === 'rating'; })[0];
        assert.deepEqual(ratingRow.field, [CONSTANTS.ATTRIBUTES.BV_RATING]);
    });

    it('rating row combines bvRating+bvReviewCount when the flag is on', function () {
        var mod = load(['REVIEW_COUNT_BOOST']);
        var ratingRow = mod.getActiveRows().filter(function (r) { return r.key === 'rating'; })[0];
        assert.deepEqual(ratingRow.field, [CONSTANTS.ATTRIBUTES.BV_RATING, CONSTANTS.ATTRIBUTES.BV_REVIEW_COUNT]);
    });

    it('build() maps each doc to a column keyed by pid (Variation Group id), never sku', function () {
        var mod = load([]);
        var docs = [
            { pid: 'VG-1', sku: 'SKU-1', title: 'Boot A', Safety_Toe: 'Composite' },
            { pid: 'VG-2', sku: 'SKU-2', title: 'Boot B', Safety_Toe: 'Steel' }
        ];

        var table = mod.build(docs);

        assert.equal(table.columns.length, 2);
        assert.equal(table.columns[0].vgId, 'VG-1');
        assert.equal(table.columns[1].vgId, 'VG-2');
        assert.equal(table.columns[0].values.safetyToe, 'Composite');
    });
});
