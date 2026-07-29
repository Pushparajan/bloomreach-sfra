'use strict';

var assert = require('chai').assert;
var sinon = require('sinon');
var proxyquire = require('proxyquire').noCallThru();

var MODULE_PATH = '../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/dwSearchFallbackHelper';
var bloomreachIdentity = require('../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/bloomreachIdentity');
var bloomreachConstants = require('../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/bloomreachConstants');

function makeProduct(overrides) {
    var custom = Object.assign({
        job_type: 'electrical',
        Toe_Shape: 'Composite',
        bvRating: 4.5,
        bvReviewCount: 12,
        sales_rank_bucket: 3
    }, overrides && overrides.custom);

    return Object.assign({
        ID: 'VG-1',
        name: 'Boot A',
        isVariationGroup: function () { return true; },
        getImage: function () { return { getURL: function () { return { toString: function () { return '/a.jpg'; } }; } }; },
        getPriceModel: function () { return { getPrice: function () { return { available: true, value: 99.99 }; } }; },
        custom: custom
    }, overrides, { custom: custom });
}

function hitsIteratorFor(hits) {
    var index = 0;
    return {
        hasNext: function () { return index < hits.length; },
        next: function () { return hits[index++]; }
    };
}

function makeSearchModelInstance(hits) {
    return {
        setOrderableProductsOnly: sinon.stub(),
        setRecursiveCategorySearch: sinon.stub(),
        addRefinementValues: sinon.stub(),
        search: sinon.stub(),
        getProductSearchHits: sinon.stub().callsFake(function () { return hitsIteratorFor(hits || []); })
    };
}

function hitFor(product) {
    return { getProduct: function () { return product; } };
}

function load(options) {
    var opts = options || {};
    var searchModelInstance = opts.searchModelInstance || makeSearchModelInstance([]);
    var FakeProductSearchModel = function () { return searchModelInstance; };
    var getProduct = opts.getProduct || sinon.stub().returns(null);

    var mod = proxyquire(MODULE_PATH, {
        'dw/catalog/ProductSearchModel': FakeProductSearchModel,
        'dw/catalog/ProductMgr': { getProduct: getProduct },
        './bloomreachConstants': bloomreachConstants,
        './bloomreachIdentity': bloomreachIdentity
    });

    return { mod: mod, searchModelInstance: searchModelInstance };
}

describe('int_ariat_bloomreach/helpers/dwSearchFallbackHelper', function () {
    describe('queryByAttributes', function () {
        it('maps search hits into Bloomreach-hit-shaped docs (pid, title, thumb_image, price, attribute fields)', function () {
            var loaded = load({ searchModelInstance: makeSearchModelInstance([hitFor(makeProduct())]) });

            var result = loaded.mod.queryByAttributes({ answers: { job_type: 'electrical' } });

            assert.deepEqual(result.response.docs[0], {
                pid: 'VG-1',
                title: 'Boot A',
                thumb_image: '/a.jpg',
                price: 99.99,
                Safety_Toe: undefined,
                Toe_Shape: 'Composite',
                Shaft_Height: undefined,
                job_type: 'electrical',
                shaft_height_in: undefined,
                safety_specs: undefined,
                feature_waterproof: undefined,
                warmth_rating: undefined,
                bvRating: 4.5,
                bvReviewCount: 12,
                sales_rank_bucket: 3
            });
        });

        it('adds a refinement per non-empty, non-object answer, and skips range ({min,max}) answers entirely', function () {
            var loaded = load();

            loaded.mod.queryByAttributes({
                answers: {
                    job_type: 'electrical',
                    safety_specs: '',
                    shaft_height_in: { min: 6, max: 8 }
                }
            });

            assert.isTrue(loaded.searchModelInstance.addRefinementValues.calledOnceWith('job_type', 'electrical'));
        });

        it('never surfaces a non-Variation-Group product as a doc (identity rule)', function () {
            var nonVg = makeProduct({ isVariationGroup: function () { return false; } });
            var loaded = load({ searchModelInstance: makeSearchModelInstance([hitFor(nonVg)]) });

            var result = loaded.mod.queryByAttributes({ answers: {} });

            assert.lengthOf(result.response.docs, 0);
        });

        it('sorts by bvRating desc by default', function () {
            var lowRatingHighReviews = makeProduct({ ID: 'VG-2', custom: { bvRating: 3, bvReviewCount: 100 } });
            var highRating = makeProduct({ ID: 'VG-1', custom: { bvRating: 5, bvReviewCount: 1 } });
            var loaded = load({
                searchModelInstance: makeSearchModelInstance([hitFor(lowRatingHighReviews), hitFor(highRating)])
            });

            var result = loaded.mod.queryByAttributes({ answers: {} });

            assert.equal(result.response.docs[0].pid, 'VG-1');
            assert.equal(result.response.docs[1].pid, 'VG-2');
        });

        it('breaks a bvRating tie by bvReviewCount only when review-count boost is enabled', function () {
            var fewerReviews = makeProduct({ ID: 'VG-1', custom: { bvRating: 4, bvReviewCount: 5 } });
            var moreReviews = makeProduct({ ID: 'VG-2', custom: { bvRating: 4, bvReviewCount: 50 } });
            var loaded = load({
                searchModelInstance: makeSearchModelInstance([hitFor(fewerReviews), hitFor(moreReviews)])
            });

            var withoutBoost = loaded.mod.queryByAttributes({ answers: {}, reviewCountBoostEnabled: false });
            assert.equal(withoutBoost.response.docs[0].pid, 'VG-1', 'tie order is stable (input order) when boost is off');

            var withBoost = loaded.mod.queryByAttributes({ answers: {}, reviewCountBoostEnabled: true });
            assert.equal(withBoost.response.docs[0].pid, 'VG-2', 'higher review count wins the tie when boost is on');
        });

        it('applies start/rows pagination the same way the live query does', function () {
            var hits = [
                hitFor(makeProduct({ ID: 'VG-1' })),
                hitFor(makeProduct({ ID: 'VG-2' })),
                hitFor(makeProduct({ ID: 'VG-3' }))
            ];
            var loaded = load({ searchModelInstance: makeSearchModelInstance(hits) });

            var result = loaded.mod.queryByAttributes({ answers: {}, rows: 2 });

            assert.lengthOf(result.response.docs, 2);
        });
    });

    describe('lookupByIds', function () {
        it('looks up each id via ProductMgr.getProduct and maps to Bloomreach-hit-shaped docs', function () {
            var getProduct = sinon.stub();
            getProduct.withArgs('VG-1').returns(makeProduct({ ID: 'VG-1' }));
            getProduct.withArgs('VG-2').returns(makeProduct({ ID: 'VG-2', name: 'Boot B' }));
            var loaded = load({ getProduct: getProduct });

            var result = loaded.mod.lookupByIds(['VG-1', 'VG-2']);

            assert.lengthOf(result.response.docs, 2);
            assert.equal(result.response.docs[0].pid, 'VG-1');
            assert.equal(result.response.docs[1].pid, 'VG-2');
        });

        it('skips an id that does not resolve to a product, rather than throwing', function () {
            var getProduct = sinon.stub().returns(null);
            var loaded = load({ getProduct: getProduct });

            var result = loaded.mod.lookupByIds(['VG-missing']);

            assert.lengthOf(result.response.docs, 0);
        });

        it('filters out malformed ids before calling ProductMgr.getProduct at all', function () {
            var getProduct = sinon.stub().returns(makeProduct());
            var loaded = load({ getProduct: getProduct });

            loaded.mod.lookupByIds(['") OR (1=1']);

            assert.isFalse(getProduct.called);
        });
    });
});
