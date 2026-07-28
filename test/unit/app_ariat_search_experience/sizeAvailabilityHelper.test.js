'use strict';

var assert = require('chai').assert;
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();

var MODULE_PATH = '../../../cartridges/app_ariat_search_experience/cartridge/scripts/bootFinder/sizeAvailabilityHelper';

function makeVariationGroup(id, variants) {
    return {
        ID: id,
        isVariationGroup: function () { return true; },
        getVariants: function () { return variants; }
    };
}

function makeVariant(size, width, orderable) {
    return {
        custom: { size: size, width: width },
        availabilityModel: { orderable: orderable }
    };
}

describe('app_ariat_search_experience/bootFinder/sizeAvailabilityHelper', function () {
    it('returns all ids unchanged when no size/width was answered (identity mapping stays VG-level)', function () {
        var mod = proxyquire(MODULE_PATH, { 'dw/catalog/ProductMgr': { getProduct: sinon.stub() } });
        var result = mod.filterByAvailability(['VG-1', 'VG-2'], undefined, undefined);
        assert.deepEqual(result, ['VG-1', 'VG-2']);
    });

    it('happy path: keeps a VG when at least one of its variants matches size+width and is orderable', function () {
        var vg = makeVariationGroup('VG-1', [
            makeVariant('9', 'D', false),
            makeVariant('10', 'D', true)
        ]);
        var ProductMgr = { getProduct: sinon.stub().returns(vg) };
        var mod = proxyquire(MODULE_PATH, { 'dw/catalog/ProductMgr': ProductMgr });

        var result = mod.filterByAvailability(['VG-1'], '10', 'D');

        assert.deepEqual(result, ['VG-1']);
    });

    it('drops a VG when no variant matches, or matches but is not orderable', function () {
        var vg = makeVariationGroup('VG-1', [makeVariant('9', 'D', false)]);
        var ProductMgr = { getProduct: sinon.stub().returns(vg) };
        var mod = proxyquire(MODULE_PATH, { 'dw/catalog/ProductMgr': ProductMgr });

        var result = mod.filterByAvailability(['VG-1'], '9', 'D');

        assert.deepEqual(result, []);
    });

    it('drops an id that does not resolve to a Variation Group at all (identity guard)', function () {
        var notAVg = { ID: 'BASE-1', isVariationGroup: function () { return false; } };
        var ProductMgr = { getProduct: sinon.stub().returns(notAVg) };
        var mod = proxyquire(MODULE_PATH, { 'dw/catalog/ProductMgr': ProductMgr });

        var result = mod.filterByAvailability(['BASE-1'], '9', 'D');

        assert.deepEqual(result, []);
    });
});
