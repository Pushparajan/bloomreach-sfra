'use strict';

var assert = require('chai').assert;
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();

var MODULE_PATH = '../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/thematicPageLookup';

function loggerStub() {
    return { getLogger: sinon.stub().returns({ warn: sinon.stub() }) };
}

function load(options) {
    var opts = options || {};
    var combos = opts.combos || [{ key: 'electrical-composite', jobType: 'electrical', safetySpec: null, toeShape: 'Composite' }];
    var content = 'content' in opts ? opts.content : {
        online: true,
        custom: { productData: JSON.stringify([{ pid: 'VG-1', title: 'Boot A' }]) }
    };

    var getContent = opts.getContent || sinon.stub().returns(content);

    return proxyquire(MODULE_PATH, {
        'dw/content/ContentMgr': { getContent: getContent },
        'dw/system/Logger': loggerStub(),
        './thematicPageCombinations': { getEnabledCombinations: sinon.stub().returns(combos) },
        './bloomreachConstants': require('../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/bloomreachConstants'),
        './bloomreachIdentity': { fromBloomreachHit: function (hit) { return { vgId: hit.pid, skuId: hit.sku }; } }
    });
}

describe('int_ariat_bloomreach/helpers/thematicPageLookup', function () {
    it('returns the matching online page\'s stored product docs when job_type/toe_shape/safety_specs match exactly', function () {
        var mod = load();

        var docs = mod.findDocs({ job_type: 'electrical', Toe_Shape: 'Composite' });

        assert.deepEqual(docs, [{ pid: 'VG-1', title: 'Boot A' }]);
    });

    it('returns null when job_type is not answered, since it is the combination matrix\'s mandatory key', function () {
        var mod = load();

        assert.isNull(mod.findDocs({}));
        assert.isNull(mod.findDocs({ Toe_Shape: 'Composite' }));
    });

    it('returns null when any answer outside job_type/toe_shape/safety_specs is present, to avoid dropping a shopper refinement', function () {
        var mod = load();

        assert.isNull(mod.findDocs({ job_type: 'electrical', Toe_Shape: 'Composite', feature_waterproof: true }));
        assert.isNull(mod.findDocs({ job_type: 'electrical', shaft_height_in: { min: 6, max: 8 } }));
    });

    it('returns null when no enabled combination matches the answers', function () {
        var mod = load({ combos: [{ key: 'welding-eh', jobType: 'welding', safetySpec: 'EH', toeShape: null }] });

        assert.isNull(mod.findDocs({ job_type: 'electrical' }));
    });

    it('returns null when the matching combination\'s content asset does not exist', function () {
        var mod = load({ getContent: sinon.stub().returns(null) });

        assert.isNull(mod.findDocs({ job_type: 'electrical', Toe_Shape: 'Composite' }));
    });

    it('returns null when the matching content asset is offline', function () {
        var mod = load({ content: { online: false, custom: { productData: '[]' } } });

        assert.isNull(mod.findDocs({ job_type: 'electrical', Toe_Shape: 'Composite' }));
    });

    it('returns null when the matching content asset has no stored productData', function () {
        var mod = load({ content: { online: true, custom: {} } });

        assert.isNull(mod.findDocs({ job_type: 'electrical', Toe_Shape: 'Composite' }));
    });

    it('returns null and logs a warning rather than throwing when productData is not valid JSON', function () {
        var mod = load({ content: { online: true, custom: { productData: 'not json' } } });

        assert.isNull(mod.findDocs({ job_type: 'electrical', Toe_Shape: 'Composite' }));
    });

    it('does not match a combination whose toeShape/safetySpec differ from the answers, even with the same job_type', function () {
        var mod = load({
            combos: [{ key: 'electrical-steel', jobType: 'electrical', safetySpec: null, toeShape: 'Steel' }],
            getContent: sinon.stub()
        });

        var docs = mod.findDocs({ job_type: 'electrical', Toe_Shape: 'Composite' });

        assert.isNull(docs);
    });

    describe('findDocsByCombinationKey', function () {
        it('returns the online page\'s stored docs, in the requested vgId order, when every id is present', function () {
            var mod = load({
                content: {
                    online: true,
                    custom: {
                        productData: JSON.stringify([
                            { pid: 'VG-1', title: 'Boot A' },
                            { pid: 'VG-2', title: 'Boot B' },
                            { pid: 'VG-3', title: 'Boot C' }
                        ])
                    }
                }
            });

            var docs = mod.findDocsByCombinationKey('electrical-composite', ['VG-2', 'VG-1']);

            assert.deepEqual(docs, [{ pid: 'VG-2', title: 'Boot B' }, { pid: 'VG-1', title: 'Boot A' }]);
        });

        it('returns null on a partial match, so the caller falls back to a live lookup rather than an incomplete comparison', function () {
            var mod = load({
                content: {
                    online: true,
                    custom: { productData: JSON.stringify([{ pid: 'VG-1', title: 'Boot A' }]) }
                }
            });

            var docs = mod.findDocsByCombinationKey('electrical-composite', ['VG-1', 'VG-2']);

            assert.isNull(docs);
        });

        it('returns null when combinationKey or vgIds is missing/empty', function () {
            var mod = load();

            assert.isNull(mod.findDocsByCombinationKey('', ['VG-1']));
            assert.isNull(mod.findDocsByCombinationKey('electrical-composite', []));
            assert.isNull(mod.findDocsByCombinationKey('electrical-composite', null));
        });

        it('returns null when the content asset is offline', function () {
            var mod = load({ content: { online: false, custom: { productData: '[]' } } });

            assert.isNull(mod.findDocsByCombinationKey('electrical-composite', ['VG-1']));
        });

        it('returns null when the content asset does not exist', function () {
            var mod = load({ getContent: sinon.stub().returns(null) });

            assert.isNull(mod.findDocsByCombinationKey('electrical-composite', ['VG-1']));
        });
    });
});
