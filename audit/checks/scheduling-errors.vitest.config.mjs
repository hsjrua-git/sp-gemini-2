import base from './component.vitest.config.mjs';

export default {
  ...base,
  test: { ...base.test, include: ['../audit/checks/scheduling-errors.test.jsx'] },
};
