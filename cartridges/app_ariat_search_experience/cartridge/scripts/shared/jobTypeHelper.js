'use strict';

/**
 * Shared job-type ("trade") picker source, used by Boot Finder's Q1 AND
 * Work-JobLanding's slug resolution, per the prompt's instruction to extract
 * this into one module rather than two independent pickers.
 *
 * ASSUMPTION: the canonical list of job types and their URL slugs is not
 * defined anywhere in a (nonexistent) real integration, so it's modeled as a
 * static list here. In a real build this would likely come from a Bloomreach
 * facet-values call or a merchandiser-editable custom object, same as the
 * Feature 4 combination matrix.
 */

var featureFlags = require('*/cartridge/scripts/helpers/featureFlags');
var constants = require('*/cartridge/scripts/helpers/bloomreachConstants');

var JOB_TYPES = [
    { value: 'electrical', slug: 'electrical', label: 'Electrical' },
    { value: 'construction', slug: 'construction', label: 'Construction' },
    { value: 'welding', slug: 'welding', label: 'Welding' },
    { value: 'agriculture', slug: 'agriculture', label: 'Agriculture / Ranch' },
    { value: 'oil-gas', slug: 'oil-gas', label: 'Oil & Gas' },
    { value: 'warehouse', slug: 'warehouse', label: 'Warehouse / Logistics' }
];

/**
 * @returns {Object[]} empty array when finder.jobType.enabled is off, so
 *   both Boot Finder Q1 and Work-JobLanding degrade the same way
 */
function getJobTypes() {
    if (!featureFlags.isEnabled('JOB_TYPE')) {
        return [];
    }
    return JOB_TYPES;
}

/**
 * @param {string} slug - URL slug segment, e.g. from /work/construction
 * @returns {Object|null}
 */
function getBySlug(slug) {
    return getJobTypes().filter(function (jt) { return jt.slug === slug; })[0] || null;
}

/**
 * @param {string} value
 * @returns {Object} single-entry fq answer map keyed by the BR field name
 */
function toAnswerFilter(value) {
    var filter = {};
    filter[constants.ATTRIBUTES.JOB_TYPE] = value;
    return filter;
}

module.exports = {
    getJobTypes: getJobTypes,
    getBySlug: getBySlug,
    toAnswerFilter: toAnswerFilter
};
