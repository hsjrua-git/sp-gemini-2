import { isUuid } from './ids.js';

export const DEFAULT_REPORT_SCOPE = { groupIds: [], assignmentIds: [], periodIds: [], dimensions: ['quality'] };

export function validReportScope(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    ['groupIds', 'assignmentIds', 'periodIds'].every(key => Array.isArray(value[key]) && value[key].length <= 200 && value[key].every(isUuid) && new Set(value[key]).size === value[key].length) &&
    Array.isArray(value.dimensions) && value.dimensions.length >= 1 && value.dimensions.length <= 2 &&
    value.dimensions.every(d => ['quality', 'quantity'].includes(d)) && new Set(value.dimensions).size === value.dimensions.length;
}
