// Shared Vitest setup, loaded before every test file (see vite.config.js).
//
// - jest-dom adds expressive DOM matchers like toBeInTheDocument() and
//   toBeDisabled() to `expect`.
// - React Testing Library mounts components into a jsdom document; cleanup()
//   unmounts them after each test so trees don't leak between cases.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
