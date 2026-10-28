import { createContext, useContext } from 'react';

// The auth context object and its consumer hook. The provider component that
// fills this in lives in AuthProvider.jsx. They are split across two files on
// purpose: React Fast Refresh only updates a module cleanly when it exports
// components alone, so the component (provider) and the non-component exports
// (this context + hook) each get their own file. This module keeps the same
// filename so the many `useAuth` importers did not have to change.
export const AuthContext = createContext(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used inside an AuthProvider.');
  }
  return context;
}
