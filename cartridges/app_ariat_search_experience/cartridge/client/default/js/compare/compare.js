'use strict';

/**
 * Comparison tool client. Add/remove/swap re-renders the table via AJAX -
 * no full page reload. "Continue to PDP" and "Add to cart" are plain links/
 * forms that hit the EXISTING product/cart controllers unmodified (see
 * compare/table.isml - the PDP link uses URLUtils.url('Product-Show', ...)
 * and any add-to-cart control this is embedded near reuses the site's
 * existing add-to-cart form, this module does not intercept it).
 */

var gtmEvents = require('../shared/gtmEvents');

var MAX_COMPARE_ITEMS = 4;
var STORAGE_KEY = 'boot-compare-selection';

function getSelection() {
    try {
        return JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || '[]');
    } catch (e) {
        return [];
    }
}

function setSelection(ids) {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

function renderTable($container, url, ids) {
    $.ajax({
        url: url,
        method: 'GET',
        data: { pids: ids.join(',') },
        success: function (html) {
            $container.find('[data-compare-table]').replaceWith(html);
        }
    });
}

module.exports = {
    init: function () {
        $(document).on('change', '[data-compare-select]', function () {
            var $checkbox = $(this);
            var vgId = $checkbox.data('vg-id');
            var ids = getSelection();

            if ($checkbox.is(':checked')) {
                if (ids.length >= MAX_COMPARE_ITEMS) {
                    $checkbox.prop('checked', false);
                    return;
                }
                ids.push(vgId);
                gtmEvents.pushEvent('compare_item_added', { vg_id: vgId });
            } else {
                ids = ids.filter(function (id) { return id !== vgId; });
                gtmEvents.pushEvent('compare_item_removed', { vg_id: vgId });
            }
            setSelection(ids);
            $(document).trigger('compare:selectionChanged', [ids]);
        });

        $(document).on('click', '[data-compare-remove]', function () {
            var vgId = $(this).data('vg-id');
            var ids = getSelection().filter(function (id) { return id !== vgId; });
            setSelection(ids);
            gtmEvents.pushEvent('compare_item_removed', { vg_id: vgId });

            var $page = $('.compare-page');
            if ($page.length) {
                if (ids.length < 2) {
                    window.location.reload();
                } else {
                    renderTable($page, $page.data('compare-url'), ids);
                }
            }
        });

        $(document).on('click', '[data-compare-view]', function (e) {
            e.preventDefault();
            var ids = getSelection();
            if (ids.length < 2) {
                return;
            }
            window.location.href = $(this).data('url') + '?pids=' + ids.join(',');
        });
    }
};
