/**
 * A single error shape for the whole API so clients can branch on a stable
 * machine-readable `code` and show `message` to a human.
 */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  toBody(): ApiErrorBody {
    return { error: { code: this.code, message: this.message } };
  }

  static badRequest(message: string): ApiError {
    return new ApiError(400, 'bad_request', message);
  }

  static unauthorized(message: string): ApiError {
    return new ApiError(401, 'unauthorized', message);
  }

  static forbidden(message: string): ApiError {
    return new ApiError(403, 'forbidden', message);
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, 'not_found', message);
  }

  static rateLimited(message: string): ApiError {
    return new ApiError(429, 'rate_limited', message);
  }
}
