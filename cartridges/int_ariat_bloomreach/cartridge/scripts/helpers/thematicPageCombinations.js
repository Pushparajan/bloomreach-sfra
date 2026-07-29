'use strict';

var CustomObjectMgr = require('dw/object/CustomObjectMgr');

/**
 * Reads the merchandiser-editable ThematicPageCombination custom object
 * matrix (see metadata/thematic-page-combination-custom-object.xml).
 * Shared by GenerateThematicPages (which builds pages from it) and Boot
 * Finder (which looks up a matching pre-generated page to reuse), so the
 * "enabled" filter and shape stay in exactly one place.
 *
 * @returns {{key: string, jobType: string, safetySpec: string|null, toeShape: string|null}[]}
 */
function getEnabledCombinations() {
    var iter = CustomObjectMgr.getAllCustomObjects('ThematicPageCombination');
    var combos = [];
    try {
        while (iter.hasNext()) {
            var co = iter.next();
            if (co.custom.enabled) {
                combos.push({
                    key: co.custom.combinationKey,
                    jobType: co.custom.jobType,
                    safetySpec: co.custom.safetySpec,
                    toeShape: co.custom.toeShape
                });
            }
        }
    } finally {
        iter.close();
    }
    return combos;
}

module.exports = {
    getEnabledCombinations: getEnabledCombinations
};
