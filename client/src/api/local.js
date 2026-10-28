// Bridge between the client's api/* layer and the on-device service layer.
//
// The desktop build reached the server over fetch (api/http.js), and pages/
// react-query learned to read two things off a rejected request: `err.status`
// (an HTTP code) and `err.data` (the parsed JSON body, e.g. `{ error: '...' }`).
//
// On device there is no fetch and no HTTP — services throw a ServiceError with a
// stable `code` instead. This wrapper runs a service call and, if it throws a
// ServiceError, re-throws an Error carrying the SAME `.status`/`.data` shape the
// UI already expects. So api/* files become thin adapters and nothing in the
// pages or react-query layers has to change.

const STATUS_FOR_CODE = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
};

export async function callService(run) {
  try {
    return await run();
  } catch (err) {
    if (err && err.name === 'ServiceError') {
      const wrapped = new Error(err.message);
      wrapped.status = STATUS_FOR_CODE[err.code] ?? 400;
      // Mirror the old JSON error body. Spread any structured details (e.g. the
      // bulk-save { problems, code } payload) alongside the message.
      wrapped.data = {
        error: err.message,
        code: err.code,
        ...(err.details ?? {}),
      };
      throw wrapped;
    }
    // Anything else is an unexpected fault — surface it as-is (no .status), which
    // the pages treat as a generic failure, matching the old ≥500 behaviour.
    throw err;
  }
}
