'use strict';

var assert = require('chai').assert;
var mod = require('../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/productBadgeBuilder');

function badgeKeys(doc) {
    return mod.buildBadges(doc).map(function (badge) { return badge.key; });
}

describe('int_ariat_bloomreach/helpers/productBadgeBuilder', function () {
    it('returns no badges for a doc with no qualifying signal', function () {
        assert.deepEqual(mod.buildBadges({ bvRating: 3, bvReviewCount: 5, sales_rank_bucket: 2 }), []);
    });

    it('returns no badges for a null/undefined doc rather than throwing', function () {
        assert.deepEqual(mod.buildBadges(null), []);
        assert.deepEqual(mod.buildBadges(undefined), []);
    });

    it('adds "Top Rated" only when both rating and review count clear their thresholds', function () {
        assert.include(badgeKeys({ bvRating: 4.5, bvReviewCount: 20 }), 'topRated');
        assert.notInclude(badgeKeys({ bvRating: 4.5, bvReviewCount: 19 }), 'topRated', 'review count just under threshold');
        assert.notInclude(badgeKeys({ bvRating: 4.4, bvReviewCount: 100 }), 'topRated', 'rating just under threshold');
    });

    it('adds "Best Seller" only when sales_rank_bucket clears its threshold', function () {
        assert.include(badgeKeys({ sales_rank_bucket: 8 }), 'bestSeller');
        assert.notInclude(badgeKeys({ sales_rank_bucket: 7 }), 'bestSeller');
    });

    it('adds a "In N+ Carts" trending badge, rounded down to the nearest bucket, only above the minimum count', function () {
        var badges = mod.buildBadges({ cart_add_count: 51 });
        assert.deepEqual(badges, [{ key: 'trending', label: 'In 50+ Carts' }]);

        assert.notInclude(badgeKeys({ cart_add_count: 9 }), 'trending', 'below the minimum meaningful count');
    });

    it('never fabricates a badge when the underlying field is absent, even if others qualify', function () {
        var badges = mod.buildBadges({ bvRating: 5, bvReviewCount: 1000, sales_rank_bucket: 10 });
        var keys = badges.map(function (badge) { return badge.key; });

        assert.include(keys, 'topRated');
        assert.include(keys, 'bestSeller');
        assert.notInclude(keys, 'trending', 'cart_add_count was never provided');
    });

    it('can return multiple badges for one doc, most-relevant first', function () {
        var badges = mod.buildBadges({
            bvRating: 4.8,
            bvReviewCount: 200,
            sales_rank_bucket: 9,
            cart_add_count: 75
        });

        assert.deepEqual(badges, [
            { key: 'topRated', label: 'Top Rated' },
            { key: 'bestSeller', label: 'Best Seller' },
            { key: 'trending', label: 'In 70+ Carts' }
        ]);
    });
});
