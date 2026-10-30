// Does this browser give us a usable WebGL context? The 3D cohort hero needs one;
// without it (old browser, blocked WebGL, headless jsdom in tests) the dashboard
// falls back to the 2D CompletionHub. Creating a throwaway context is the only
// honest check — feature-detecting the constructor isn't enough, since a context
// can still fail to allocate. Memoised: the answer can't change within a page.
let cached;

export function hasWebGL() {
  if (cached !== undefined) return cached;
  if (typeof document === 'undefined') {
    cached = false;
    return cached;
  }
  try {
    const canvas = document.createElement('canvas');
    cached = Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    cached = false;
  }
  return cached;
}

// Test-only: forget the memoised answer so a suite can exercise both branches.
export function resetWebGLCache() {
  cached = undefined;
}
