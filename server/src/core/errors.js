// Typed errors for the framework-free service layer.
//
// Route handlers used to signal outcomes with HTTP status codes
// (res.status(400)/(404)/(500)). Service functions can't know about HTTP —
// they run on-device in the webview — so they throw a ServiceError with a
// stable `code` instead. The (thin) caller that adapts a service to the client
// maps these codes to whatever it needs (a status, a toast, a form error).
//
//   VALIDATION — bad input; message is safe to show the user.
//   NOT_FOUND  — the addressed row does not exist (or is soft-deleted).
//   CONFLICT   — a constraint prevented the write (e.g. couldn't mint a code).
//
// Anything else that throws is an unexpected/internal fault and should surface
// as a generic failure, exactly like the old ≥500 handler hid its detail.

export class ServiceError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    // Optional structured payload for callers that need more than a message
    // (e.g. the bulk-save path attaches { problems, code } the UI renders).
    if (details !== undefined) this.details = details;
  }

  static validation(message, details) {
    return new ServiceError('VALIDATION', message, details);
  }

  static notFound(message = 'Not found.', details) {
    return new ServiceError('NOT_FOUND', message, details);
  }

  static conflict(message, details) {
    return new ServiceError('CONFLICT', message, details);
  }
}

export function isServiceError(err) {
  return err instanceof ServiceError;
}
