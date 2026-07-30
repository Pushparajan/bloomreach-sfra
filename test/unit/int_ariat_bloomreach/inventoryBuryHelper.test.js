'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru();

var MODULE_PATH = '../../../cartridges/int_ariat_bloomreach/cartridge/scripts/helpers/inventoryBuryHelper';

function load(threshold) {
    return proxyquire(MODULE_PATH, {
        'dw/system/Site': {
            getCurrent: function () {
                return {
                    getCustomPreferenceValue: function () { return threshold; }
                };
            }
        }
    });
}

describe('int_ariat_bloomreach/helpers/inventoryBuryHelper', function () {
    describe('getBuryFilterQuery', function () {
        it('returns null when no threshold is configured, so no fragment is appended at all', function () {
            assert.isNull(load(null).getBuryFilterQuery());
            assert.isNull(load(undefined).getBuryFilterQuery());
        });

        it('returns a threshold of 0 as a real fragment rather than treating it as unconfigured', function () {
            assert.isString(load(0).getBuryFilterQuery());
        });

        // The fragment is joined into a conjunction by
        // bloomreachAttributeQueryHelper, where AND binds tighter than OR.
        // An ungrouped `A OR B` leaks B to the top level and matches
        // low-stock products regardless of the shopper's other filters.
        it('is a single self-contained group, so it cannot leak a clause out of an AND-join', function () {
            var fragment = load(5).getBuryFilterQuery();

            assert.equal(fragment.charAt(0), '(');
            assert.equal(fragment.charAt(fragment.length - 1), ')');

            // Every OR in the fragment must sit inside the outer group:
            // walking the string, depth only returns to 0 at the very last
            // character. Anything earlier means a clause sits outside the
            // group and would escape an enclosing AND.
            var depth = 0;
            var last = fragment.length - 1;
            for (var i = 0; i <= last; i += 1) {
                var char = fragment.charAt(i);
                if (char === '(') {
                    depth += 1;
                } else if (char === ')') {
                    depth -= 1;
                }
                if (i < last) {
                    assert.isAbove(depth, 0, 'group closed early at index ' + i + ': ' + fragment);
                }
            }
            assert.equal(depth, 0, 'unbalanced parentheses: ' + fragment);
        });

        it('uses only positive boosts - Lucene has no negative boost, `^-0.5` is a parse error not a demotion', function () {
            var fragment = load(5).getBuryFilterQuery();

            assert.notInclude(fragment, '^-');
        });

        it('boosts in-stock above low-stock, which is how a bury is expressed without a negative weight', function () {
            var fragment = load(5).getBuryFilterQuery();

            assert.include(fragment, 'inventory_level:[5 TO *]^2');
            assert.include(fragment, 'inventory_level:[* TO 5]^0.1');
        });

        it('matches products with no inventory_level at all, keeping the documented "never hard-filter" promise', function () {
            var fragment = load(5).getBuryFilterQuery();

            assert.include(fragment, '(*:* -inventory_level:[* TO *])');
        });
    });
});
