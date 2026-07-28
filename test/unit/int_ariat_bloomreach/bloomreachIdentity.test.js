'use strict';

var assert = require('chai').assert;
var identity = require('../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/bloomreachIdentity');

describe('int_ariat_bloomreach/helpers/bloomreachIdentity', function () {
    describe('requireVariationGroupId', function () {
        it('returns the id when the product is a Variation Group', function () {
            var vg = { ID: 'VG-001', isVariationGroup: function () { return true; } };
            assert.equal(identity.requireVariationGroupId(vg), 'VG-001');
        });

        it('throws when given a non-Variation-Group product (e.g. a bare Variant)', function () {
            var variant = { ID: 'SKU-001', isVariationGroup: function () { return false; } };
            assert.throws(function () { identity.requireVariationGroupId(variant); }, /not a Variation Group/);
        });

        it('throws when product is missing', function () {
            assert.throws(function () { identity.requireVariationGroupId(null); }, /product is required/);
        });
    });

    describe('requireVariantId', function () {
        it('returns the id when the product is a Variant', function () {
            var variant = { ID: 'SKU-001', isVariant: function () { return true; } };
            assert.equal(identity.requireVariantId(variant), 'SKU-001');
        });

        it('throws when given a non-Variant product (e.g. a Variation Group or Base Product)', function () {
            var vg = { ID: 'VG-001', isVariant: function () { return false; } };
            assert.throws(function () { identity.requireVariantId(vg); }, /not a Variant/);
        });
    });

    describe('fromBloomreachHit', function () {
        it('maps pid -> vgId and sku -> skuId using the documented field names', function () {
            var result = identity.fromBloomreachHit({ pid: 'VG-001', sku: 'SKU-001', title: 'Work Boot' });
            assert.deepEqual(result, { vgId: 'VG-001', skuId: 'SKU-001' });
        });

        it('never falls back to another field if pid/sku are absent - returns null instead of guessing', function () {
            var result = identity.fromBloomreachHit({ id: 'SOME-OTHER-ID', title: 'Work Boot' });
            assert.deepEqual(result, { vgId: null, skuId: null });
        });

        it('handles a null hit without throwing', function () {
            assert.deepEqual(identity.fromBloomreachHit(null), { vgId: null, skuId: null });
        });
    });

    describe('isWellFormedId', function () {
        it('accepts alphanumeric/dash/underscore ids', function () {
            assert.isTrue(identity.isWellFormedId('VG-001_abc'));
        });

        it('rejects ids containing query-injection characters', function () {
            assert.isFalse(identity.isWellFormedId('VG-001") OR (1=1'));
            assert.isFalse(identity.isWellFormedId(''));
            assert.isFalse(identity.isWellFormedId(null));
        });
    });
});
