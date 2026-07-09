// Operational error with an attached HTTP status code. Throw this from services
// or controllers for expected failures (validation, not found, etc.); the
// centralized error handler turns it into a clean JSON response.
export class AppError extends Error {
  readonly statusCode: number;
  readonly isOperational: boolean;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message: string) {
    return new AppError(400, message);
  }

  static notFound(message = 'Resource not found') {
    return new AppError(404, message);
  }

  static conflict(message: string) {
    return new AppError(409, message);
  }
}
