'use strict';

var assert = require('chai').assert;
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();

var MODULE_PATH = '../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/thematicPageCombinations';

function iteratorFor(combos) {
    var index = 0;
    return {
        hasNext: function () { return index < combos.length; },
        next: function () { return { custom: combos[index++] }; },
        close: function () {}
    };
}

function load(combos) {
    return proxyquire(MODULE_PATH, {
        'dw/object/CustomObjectMgr': { getAllCustomObjects: sinon.stub().returns(iteratorFor(combos)) }
    });
}

describe('int_ariat_bloomreach/helpers/thematicPageCombinations', function () {
    it('maps enabled custom objects to the {key, jobType, safetySpec, toeShape} shape', function () {
        var mod = load([
            { combinationKey: 'electrical-composite', jobType: 'electrical', safetySpec: null, toeShape: 'Composite', enabled: true }
        ]);

        var combos = mod.getEnabledCombinations();

        assert.deepEqual(combos, [
            { key: 'electrical-composite', jobType: 'electrical', safetySpec: null, toeShape: 'Composite' }
        ]);
    });

    it('excludes disabled combinations', function () {
        var mod = load([
            { combinationKey: 'welding-eh', jobType: 'welding', safetySpec: 'EH', toeShape: null, enabled: false },
            { combinationKey: 'electrical-composite', jobType: 'electrical', safetySpec: null, toeShape: 'Composite', enabled: true }
        ]);

        var combos = mod.getEnabledCombinations();

        assert.lengthOf(combos, 1);
        assert.equal(combos[0].key, 'electrical-composite');
    });

    it('closes the iterator even when combos is empty', function () {
        var iter = iteratorFor([]);
        var closeSpy = sinon.spy(iter, 'close');
        var mod = proxyquire(MODULE_PATH, {
            'dw/object/CustomObjectMgr': { getAllCustomObjects: sinon.stub().returns(iter) }
        });

        mod.getEnabledCombinations();

        assert.isTrue(closeSpy.called);
    });
});
