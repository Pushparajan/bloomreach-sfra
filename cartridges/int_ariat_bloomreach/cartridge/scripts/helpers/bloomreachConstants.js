'use strict';

/**
 * Shared constants for the Bloomreach Discovery integration.
 *
 * Identity rule (applies everywhere in this cartridge and any consumer):
 *   Bloomreach "product"  == SFCC Variation Group (colorway) -> field PID_FIELD
 *   Bloomreach "sku"      == SFCC Variation (sellable unit)  -> field SKU_FIELD
 * Never pass a Base Product ID or a bare Variant/SKU ID where a VG ID is
 * expected, and vice versa. See helpers/bloomreachIdentity.js for the
 * enforcement helpers.
 */
module.exports = {
    IDENTITY: {
        // Bloomreach response field carrying the Variation Group id.
        PID_FIELD: 'pid',
        // Bloomreach response field carrying the Variation (SKU) id.
        SKU_FIELD: 'sku'
    },

    // Attribute field names as they are expected to land in the Bloomreach
    // index. See prompt's "Shared Attribute Dependencies" table for status.
    ATTRIBUTES: {
        SAFETY_TOE: 'Safety_Toe',
        TOE_SHAPE: 'Toe_Shape',
        SHAFT_HEIGHT: 'Shaft_Height',
        JOB_TYPE: 'job_type',
        SHAFT_HEIGHT_IN: 'shaft_height_in',
        SAFETY_SPECS: 'safety_specs',
        FEATURE_WATERPROOF: 'feature_waterproof',
        WARMTH_RATING: 'warmth_rating',
        BV_RATING: 'bvRating',
        BV_REVIEW_COUNT: 'bvReviewCount',
        SALES_RANK_BUCKET: 'sales_rank_bucket'
    },

    /**
     * Maps the logical (dot-notation) flag names used in product/eng docs to
     * real Site Preference custom attribute IDs (SFCC preference IDs cannot
     * contain dots). Every consumer must resolve flags through
     * helpers/featureFlags.js rather than calling Site.getCustomPreference
     * with a raw string, so the mapping lives in exactly one place.
     */
    FEATURE_FLAGS: {
        JOB_TYPE: 'finderJobTypeEnabled', // finder.jobType.enabled
        SHAFT_HEIGHT_RANGE: 'finderShaftHeightRangeEnabled', // finder.shaftHeightRange.enabled
        SAFETY_SPEC_REFINEMENT: 'finderSafetySpecRefinementEnabled', // finder.safetySpecRefinement.enabled
        WATERPROOF_QUESTION: 'finderWaterproofQuestionEnabled', // finder.waterproofQuestion.enabled
        INSULATION_QUESTION: 'finderInsulationQuestionEnabled', // finder.insulationQuestion.enabled
        REVIEW_COUNT_BOOST: 'finderReviewCountBoostEnabled', // finder.reviewCountBoost.enabled
        SALES_RANK_TIEBREAK: 'finderSalesRankTiebreakEnabled', // finder.salesRankTiebreak.enabled
        LOOMI_ENABLED: 'loomiEnabled' // loomi.enabled
    },

    // Short-TTL cache (minutes) for stateful/per-request routes (Boot Finder,
    // Comparison Tool). Not "no-cache" at the CDN layer so a burst of
    // identical anonymous requests within the same minute can still be
    // absorbed, but short enough that it never behaves like a normal PLP.
    SHORT_CACHE_MINUTES: 0.25
};
