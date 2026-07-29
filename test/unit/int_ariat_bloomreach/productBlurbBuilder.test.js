'use strict';

var assert = require('chai').assert;
var mod = require('../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/productBlurbBuilder');

function docsOf(count, overrides) {
    var docs = [];
    for (var i = 0; i < count; i += 1) {
        docs.push(Object.assign({ pid: 'VG-' + i, title: 'Boot ' + i, price: 100 }, overrides));
    }
    return docs;
}

describe('int_ariat_bloomreach/helpers/productBlurbBuilder', function () {
    describe('buildBlurb', function () {
        it('returns null below the minimum product count, where aggregates are not meaningful', function () {
            assert.isNull(mod.buildBlurb(docsOf(2), { jobType: 'electrical' }));
            assert.isNull(mod.buildBlurb([], { jobType: 'electrical' }));
            assert.isNull(mod.buildBlurb(null, { jobType: 'electrical' }));
        });

        it('builds a sentence from count, descriptor and price range', function () {
            var docs = [
                { price: 89 },
                { price: 150 },
                { price: 249 }
            ];

            var blurb = mod.buildBlurb(docs, { jobType: 'electrical', toeShape: 'Composite' });

            assert.equal(blurb, 'Browse 3 composite toe electrical work boots, from $89 to $249.');
        });

        it('states a single price rather than a range when every product costs the same', function () {
            var blurb = mod.buildBlurb(docsOf(3, { price: 120 }), { jobType: 'welding' });

            assert.include(blurb, 'priced at $120');
            assert.notInclude(blurb, ' to ');
        });

        it('includes a safety spec in the lead clause when the combination has one', function () {
            var blurb = mod.buildBlurb(docsOf(3), { jobType: 'welding', safetySpec: 'EH' });

            assert.include(blurb, 'welding work boots rated for EH');
        });

        it('weights the average rating by review volume, so a 1-review 5-star cannot outweigh a high-volume 4.0', function () {
            var docs = [
                { price: 100, bvRating: 5, bvReviewCount: 1 },
                { price: 100, bvRating: 4, bvReviewCount: 999 },
                { price: 100, bvRating: 4, bvReviewCount: 1000 }
            ];

            var blurb = mod.buildBlurb(docs, { jobType: 'electrical' });

            assert.include(blurb, 'averaging 4 out of 5 stars across 2000 customer reviews');
        });

        it('omits the rating clause entirely when total review volume is below the credibility threshold', function () {
            var docs = docsOf(3, { bvRating: 4.9, bvReviewCount: 2 });

            var blurb = mod.buildBlurb(docs, { jobType: 'electrical' });

            assert.notInclude(blurb, 'stars');
            assert.notInclude(blurb, 'averaging');
        });

        it('never emits "undefined" for a missing field - it drops that clause instead', function () {
            var blurb = mod.buildBlurb(docsOf(3, { price: undefined }), { jobType: 'electrical' });

            assert.isNull(blurb, 'with no price and no ratings there is nothing beyond the bare count to say');
        });

        it('adds a waterproof clause only when most of the set is waterproof', function () {
            var mostly = [
                { price: 100, feature_waterproof: true },
                { price: 100, feature_waterproof: true },
                { price: 100, feature_waterproof: false }
            ];
            assert.include(mod.buildBlurb(mostly, { jobType: 'electrical' }), 'with waterproof options available');

            var few = [
                { price: 100, feature_waterproof: true },
                { price: 100, feature_waterproof: false },
                { price: 100, feature_waterproof: false }
            ];
            assert.notInclude(mod.buildBlurb(few, { jobType: 'electrical' }), 'waterproof');
        });

        it('produces genuinely different copy for different combinations, so pages are not duplicate content', function () {
            var electrical = mod.buildBlurb([{ price: 89 }, { price: 100 }, { price: 150 }], {
                jobType: 'electrical', toeShape: 'Composite'
            });
            var welding = mod.buildBlurb([{ price: 200 }, { price: 240 }, { price: 300 }], {
                jobType: 'welding', toeShape: 'Steel'
            });

            assert.notEqual(electrical, welding);
        });
    });

    describe('summarize', function () {
        it('reports null price bounds and rating when nothing is derivable', function () {
            var stats = mod.summarize([{ pid: 'VG-1' }, { pid: 'VG-2' }]);

            assert.isNull(stats.minPrice);
            assert.isNull(stats.maxPrice);
            assert.isNull(stats.averageRating);
            assert.isNull(stats.totalReviews);
            assert.equal(stats.productCount, 2);
        });

        it('ignores zero/negative prices rather than treating them as a $0 low bound', function () {
            var stats = mod.summarize([{ price: 0 }, { price: 120 }, { price: 90 }]);

            assert.equal(stats.minPrice, 90);
            assert.equal(stats.maxPrice, 120);
        });
    });
});
