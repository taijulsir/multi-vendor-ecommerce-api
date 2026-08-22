import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { Prisma } from '../../generated/prisma/client';

interface ErrorResponseBody {
  statusCode: number;
  message: string;
  error: string;
}

const GENERIC_CONFLICT_MESSAGE = 'A conflicting record already exists.';
const GENERIC_NOT_FOUND_MESSAGE = 'The requested resource was not found.';
const GENERIC_SERVER_ERROR_MESSAGE = 'An unexpected error occurred.';

// Widened to a plain `number` deliberately — `exception.getStatus()`
// already returns `number`, not `HttpStatus`, so comparing it directly
// against an `HttpStatus` enum member trips
// `@typescript-eslint/no-unsafe-enum-comparison`. This constant keeps the
// comparison tied to the enum's meaning rather than a bare magic number.
const INTERNAL_SERVER_ERROR_STATUS: number = HttpStatus.INTERNAL_SERVER_ERROR;

/**
 * The last line of defense, not the primary error-handling mechanism.
 * Every service in this codebase already translates the domain-meaningful
 * Prisma error codes it can produce (P2002/P2003/P2025/...) into typed
 * `HttpException`s *before* they would ever reach here — confirmed by a
 * full-codebase audit (`docs/project-completion-audit.md` Part 5 §7: "no
 * raw Prisma leakage confirmed"). This filter deliberately does **not**
 * re-implement that per-service translation (see this phase's "Critical
 * Rule": do not blindly re-normalize errors that already carry meaningful
 * semantics) — every `HttpException`, however it was constructed, is
 * passed straight through with its existing status and response body
 * completely untouched. That is what keeps 401/403/404/409 meaning
 * exactly what each service already made them mean.
 *
 * What this filter *does* own: (1) a narrow, explicit safety net for the
 * two Prisma error codes named in this phase's instructions (P2002 → 409,
 * P2025 → 404) in the case one somehow escapes service-level translation,
 * and (2) a safe, detail-free 500 for genuinely unexpected exceptions —
 * any other Prisma error, any other `Error`, or any non-`Error` thrown
 * value. No stack trace, Prisma metadata, SQL, file path, or secret ever
 * reaches the client; diagnostic detail is only ever written server-side
 * via `Logger`, and only for the 5xx case (routine 4xx business
 * exceptions are not logged — they are normal, expected control flow).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      this.logIfServerError(status, request, exception);
      response.status(status).json(exception.getResponse());
      return;
    }

    const { status, body } = this.mapUnhandledException(exception);
    this.logIfServerError(status, request, exception);
    response.status(status).json(body);
  }

  private mapUnhandledException(exception: unknown): {
    status: number;
    body: ErrorResponseBody;
  } {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          body: {
            statusCode: HttpStatus.CONFLICT,
            message: GENERIC_CONFLICT_MESSAGE,
            error: 'Conflict',
          },
        };
      }

      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          body: {
            statusCode: HttpStatus.NOT_FOUND,
            message: GENERIC_NOT_FOUND_MESSAGE,
            error: 'Not Found',
          },
        };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: GENERIC_SERVER_ERROR_MESSAGE,
        error: 'Internal Server Error',
      },
    };
  }

  private logIfServerError(
    status: number,
    request: Request,
    exception: unknown,
  ): void {
    if (status < INTERNAL_SERVER_ERROR_STATUS) {
      return;
    }

    const detail =
      exception instanceof Error
        ? (exception.stack ?? exception.message)
        : this.safeDescribe(exception);

    this.logger.error(`${request.method} ${request.url} → ${status}`, detail);
  }

  private safeDescribe(exception: unknown): string {
    try {
      return JSON.stringify(exception);
    } catch {
      return String(exception);
    }
  }
}
