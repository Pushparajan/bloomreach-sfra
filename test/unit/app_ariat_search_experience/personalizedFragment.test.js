'use strict';

var assert = require('chai').assert;

var MODULE_PATH = '../../../cartridges/app_ariat_search_experience/cartridge/client/default/js/shared/personalizedFragment';

/**
 * Client-side module, so `window` and jQuery's `$` are stubbed as globals
 * rather than pulling in a DOM library for what is pure URL logic.
 *
 * @param {string} pathname - the page the shopper is currently on
 * @param {string|null} serverBase - value of any
 *   [data-personalized-fragment-base] attribute rendered by the shell
 * @returns {Object} the module under test
 */
function load(pathname, serverBase) {
    global.window = { location: { pathname: pathname } };
    global.$ = function () {
        return {
            data: function () { return serverBase; }
        };
    };
    delete require.cache[require.resolve(MODULE_PATH)];
    return require(MODULE_PATH);
}

describe('app_ariat_search_experience/client/shared/personalizedFragment', function () {
    afterEach(function () {
        delete global.window;
        delete global.$;
        delete require.cache[require.resolve(MODULE_PATH)];
    });

    describe('resolveFragmentUrl', function () {
        it('prefers a server-rendered base URL, the only source that knows the site/locale prefix', function () {
            var mod = load(
                '/boots/mens-work-boot.html',
                '/on/demandware.store/Sites-Ariat-Site/default'
            );

            assert.equal(
                mod.resolveFragmentUrl('Product-PersonalizedStrip', { pid: 'VG-1' }),
                '/on/demandware.store/Sites-Ariat-Site/default/Product-PersonalizedStrip?pid=VG-1'
            );
        });

        it('does not double up the separator when the server-rendered base has a trailing slash', function () {
            var mod = load('/anything', '/on/demandware.store/Sites-Ariat-Site/default/');

            assert.equal(
                mod.resolveFragmentUrl('Search-PersonalizedRail', { cgid: 'work-boots' }),
                '/on/demandware.store/Sites-Ariat-Site/default/Search-PersonalizedRail?cgid=work-boots'
            );
        });

        it('derives the URL from a pipeline-style path when no server-rendered base is present', function () {
            var mod = load('/on/demandware.store/Sites-Ariat-Site/default/Product-Show', null);

            assert.equal(
                mod.resolveFragmentUrl('Product-PersonalizedStrip', { pid: 'VG-1' }),
                '/on/demandware.store/Sites-Ariat-Site/default/Product-PersonalizedStrip?pid=VG-1'
            );
        });

        // Regression: deriving unconditionally turned an SEO-friendly PDP
        // URL into /boots/Product-PersonalizedStrip - a 404 the shopper
        // never sees, silently disabling personalization on exactly the
        // pages it was built for. Skipping is the honest failure mode.
        it('returns null on an SEO-friendly product URL rather than requesting a URL it knows is wrong', function () {
            var mod = load('/boots/mens-work-boot.html', null);

            assert.isNull(mod.resolveFragmentUrl('Product-PersonalizedStrip', { pid: 'VG-1' }));
        });

        it('returns null on an SEO-friendly category URL', function () {
            var mod = load('/womens-western/', null);

            assert.isNull(mod.resolveFragmentUrl('Search-PersonalizedRail', { cgid: 'womens-western' }));
        });

        it('returns null at the site root, where there is no last path segment to swap', function () {
            var mod = load('/', null);

            assert.isNull(mod.resolveFragmentUrl('Search-PersonalizedRail', { cgid: 'x' }));
        });

        it('omits the query string entirely when no params have values', function () {
            var mod = load('/on/demandware.store/Sites-Ariat-Site/default/Product-Show', null);

            assert.equal(
                mod.resolveFragmentUrl('Product-PersonalizedStrip', { pid: '' }),
                '/on/demandware.store/Sites-Ariat-Site/default/Product-PersonalizedStrip'
            );
        });

        it('url-encodes param values', function () {
            var mod = load('/on/demandware.store/Sites-Ariat-Site/default/Search-Show', null);

            assert.include(
                mod.resolveFragmentUrl('Search-PersonalizedRail', { cgid: 'oil & gas' }),
                'cgid=oil%20%26%20gas'
            );
        });
    });
});
