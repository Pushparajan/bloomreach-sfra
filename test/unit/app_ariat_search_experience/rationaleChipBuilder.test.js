'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

var MODULE_PATH = '../../../cartridges/app_ariat_search_experience/cartridge/scripts/bootFinder/rationaleChipBuilder';
var CONSTANTS = require('../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/bloomreachConstants');

var mod = proxyquire(MODULE_PATH, {
    '*/cartridge/scripts/helpers/bloomreachConstants': CONSTANTS
});

describe('app_ariat_search_experience/bootFinder/rationaleChipBuilder', function () {
    it('happy path: emits one chip per answered question the hit actually satisfies', function () {
        var answers = { Safety_Toe: 'Composite', Toe_Shape: 'Round' };
        var hit = { pid: 'VG-1', Safety_Toe: 'Composite', Toe_Shape: 'Square' };

        var chips = mod.buildChips(answers, hit);

        assert.deepEqual(chips, [{ field: 'Safety_Toe', label: 'Composite Toe' }]);
    });

    it('matches a range answer (shaft_height_in) against a numeric hit value', function () {
        var answers = { shaft_height_in: { min: 6, max: 10 } };
        var hit = { pid: 'VG-1', shaft_height_in: 8 };

        var chips = mod.buildChips(answers, hit);

        assert.deepEqual(chips, [{ field: 'shaft_height_in', label: '8" Shaft' }]);
    });

    it('matches a multi-select answer against an array-valued hit field', function () {
        var answers = { safety_specs: 'ASTM-F2413' };
        var hit = { pid: 'VG-1', safety_specs: ['ASTM-F2413', 'EH'] };

        var chips = mod.buildChips(answers, hit);

        assert.deepEqual(chips, [{ field: 'safety_specs', label: 'ASTM-F2413' }]);
    });

    it('never emits a chip for a field the hit does not carry (e.g. flag-gated attribute absent from index)', function () {
        var answers = { feature_waterproof: true };
        var hit = { pid: 'VG-1' };

        assert.deepEqual(mod.buildChips(answers, hit), []);
    });

    it('never emits a chip for an unrecognized field, even if present on both sides', function () {
        var answers = { some_unmapped_field: 'x' };
        var hit = { pid: 'VG-1', some_unmapped_field: 'x' };

        assert.deepEqual(mod.buildChips(answers, hit), []);
    });
});
