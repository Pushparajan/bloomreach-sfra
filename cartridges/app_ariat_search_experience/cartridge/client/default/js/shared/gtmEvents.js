'use strict';

/**
 * ASSUMPTION: no existing GTM dataLayer implementation was found to mirror
 * (greenfield repo). This models the common SFRA/GTM convention -
 * `window.dataLayer.push({ event: 'snake_case_name', ...snake_case payload
 * })` - so the shape is at least consistent for both Boot Finder and the
 * Comparison Tool. Before shipping, replace this with (or point it at) the
 * site's real dataLayer helper and reconcile event/property naming with
 * whatever convention already exists.
 */
function pushEvent(eventName, payload) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event: eventName }, payload || {}));
}

module.exports = {
    pushEvent: pushEvent
};
