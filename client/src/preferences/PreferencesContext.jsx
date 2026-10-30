import { createContext, useContext } from 'react';

// The preferences context object and its consumer hook. The provider component
// that fills this in lives in PreferencesProvider.jsx. They are split across two
// files on purpose: React Fast Refresh only updates a module cleanly when it
// exports components alone, so the component (provider) and the non-component
// exports (this context + hook) each get their own file. This module keeps the
// same filename so the existing `usePreferences` importers did not have to change.
export const PreferencesContext = createContext(null);

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (context === null) {
    throw new Error('usePreferences must be used inside a PreferencesProvider.');
  }
  return context;
}
