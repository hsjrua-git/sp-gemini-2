import { lazy } from 'react';

// A drop-in replacement for React.lazy that survives a failed dynamic import.
//
// Every page behind login is code-split, so navigating to one fetches its
// JavaScript chunk on demand. That fetch can fail for a reason that has nothing
// to do with the code: the user's tab is holding an OLD build (its chunk file
// names no longer exist on the server after a rebuild/redeploy), or the network
// blipped mid-navigation. Unhandled, the rejected import bubbles to the root
// error boundary and blanks the whole app behind a "Something went wrong /
// Reload" screen — which is exactly why a manual reload "fixes" it.
//
// Here we do that reload automatically, exactly once. The one-shot guard lives
// in sessionStorage on purpose: the page reload we trigger wipes every plain
// variable and all React state, so those cannot remember "we already tried" —
// sessionStorage is the only thing that survives the reload it is guarding. If
// the import still fails after the single reload (a real, persistent problem,
// not a stale chunk), we rethrow so the error boundary shows its message rather
// than reloading forever.
const RELOAD_FLAG = 'chunk-reload-attempted';

function readFlag() {
  try {
    return sessionStorage.getItem(RELOAD_FLAG) === '1';
  } catch {
    return false;
  }
}

function writeFlag(value) {
  try {
    if (value) sessionStorage.setItem(RELOAD_FLAG, '1');
    else sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // sessionStorage can be unavailable (private mode, disabled). Losing the
    // guard only means the fallback below can't dedupe; it never breaks a
    // normal load, so there is nothing to do here.
  }
}

export function lazyWithReload(importer) {
  // Memoize the load so React.lazy and an explicit .preload() below share a
  // single in-flight import (calling it twice must not fetch the chunk twice).
  let promise;
  const load = () => {
    if (!promise) promise = attempt();
    return promise;
  };

  async function attempt() {
    try {
      const module = await importer();
      // A clean load means any earlier stale-chunk trouble is over; clear the
      // guard so a genuine future failure can still earn its own single reload.
      writeFlag(false);
      return module;
    } catch (error) {
      if (readFlag()) {
        // We already reloaded once and it still failed — stop looping and let
        // the error boundary report it.
        throw error;
      }
      writeFlag(true);
      window.location.reload();
      // Keep the Suspense fallback on screen for the instant before the reload
      // takes over by returning a promise that never resolves.
      return new Promise(() => {});
    }
  }

  const Component = lazy(load);
  // Lets the router kick off a page's chunk download *before* navigating to it
  // (App.jsx preloads the target route so a view transition captures the real
  // page, not the Suspense loader). Idempotent — resolves instantly once the
  // chunk is cached, and shares the very promise React.lazy will await.
  Component.preload = load;
  return Component;
}
