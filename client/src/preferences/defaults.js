export const DEFAULT_PREFERENCES = {
  theme: 'dark',
  palette: 'aurora',
  language: 'fa',
  studentsPageSize: 25,
  studentsSort: 'newest',
  studentsShowCode: true,
  studentsShowAdded: true,
  studentDefaultTab: 'overview',
  studentShowAllPeriods: false,
  hiddenParameterIds: [],
  csvDelimiter: ',',
  // The dashboard hero/constellation customization (schema-4): which dimension
  // feeds the values, what counts as "answered", and which assignment period
  // the class field shows (null = the assignment's latest period).
  dashboardConstellation: {
    dimension: 'quality',
    basis: 'value',
    assignmentId: null,
    seq: null,
  },
};