import type { ArgumentsHost } from '@nestjs/common';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  const jsonMock = jest.fn();
  const statusMock = jest.fn(() => ({ json: jsonMock }));

  const buildHost = (): ArgumentsHost =>
    ({
      switchToHttp: () => ({
        getResponse: () => ({ status: statusMock }),
        getRequest: () => ({ method: 'GET', url: '/api/some/path' }),
      }),
    }) as unknown as ArgumentsHost;

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new AllExceptionsFilter();
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  });

  const capturedBody = () => jsonMock.mock.calls[0][0];
  const capturedStatus = () => statusMock.mock.calls[0][0];

  describe('HttpException pass-through — exact status/body preserved', () => {
    it('passes a BadRequestException through unchanged (400)', () => {
      const exception = new BadRequestException('Invalid payload');
      filter.catch(exception, buildHost());

      expect(capturedStatus()).toBe(400);
      expect(capturedBody()).toEqual(exception.getResponse());
    });

    it('passes an UnauthorizedException through unchanged (401)', () => {
      const exception = new UnauthorizedException();
      filter.catch(exception, buildHost());

      expect(capturedStatus()).toBe(401);
      expect(capturedBody()).toEqual(exception.getResponse());
    });

    it('passes a ForbiddenException through unchanged (403)', () => {
      const exception = new ForbiddenException(
        'You do not have permission to perform this action.',
      );
      filter.catch(exception, buildHost());

      expect(capturedStatus()).toBe(403);
      expect(capturedBody()).toEqual(exception.getResponse());
    });

    it('passes a NotFoundException through unchanged (404)', () => {
      const exception = new NotFoundException('Product not found');
      filter.catch(exception, buildHost());

      expect(capturedStatus()).toBe(404);
      expect(capturedBody()).toEqual(exception.getResponse());
    });

    it('passes a ConflictException through unchanged (409)', () => {
      const exception = new ConflictException('This slug is already in use');
      filter.catch(exception, buildHost());

      expect(capturedStatus()).toBe(409);
      expect(capturedBody()).toEqual(exception.getResponse());
    });

    it('passes a ValidationPipe-style BadRequestException (array message) through unchanged', () => {
      const exception = new BadRequestException([
        'email must be an email',
        'password should not be empty',
      ]);
      filter.catch(exception, buildHost());

      expect(capturedStatus()).toBe(400);
      expect(capturedBody()).toEqual(exception.getResponse());
      expect((capturedBody() as { message: string[] }).message).toEqual([
        'email must be an email',
        'password should not be empty',
      ]);
    });

    it('does not log routine 4xx business exceptions', () => {
      filter.catch(new NotFoundException('x'), buildHost());
      expect(filter['logger'].error).not.toHaveBeenCalled();
    });
  });

  describe('Prisma error safety net', () => {
    it('maps an untranslated P2002 to a generic 409, never leaking Prisma metadata', () => {
      const exception = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`email`)',
        {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['email'], modelName: 'User' },
        },
      );

      filter.catch(exception, buildHost());

      expect(capturedStatus()).toBe(409);
      const body = capturedBody() as Record<string, unknown>;
      expect(body.statusCode).toBe(409);
      expect(body.error).toBe('Conflict');
      expect(JSON.stringify(body)).not.toContain('email');
      expect(JSON.stringify(body)).not.toContain('User');
      expect(JSON.stringify(body)).not.toContain('Unique constraint');
    });

    it('maps an untranslated P2025 to a generic 404, never leaking Prisma metadata', () => {
      const exception = new Prisma.PrismaClientKnownRequestError(
        'An operation failed because it depends on one or more records that were required but not found.',
        { code: 'P2025', clientVersion: 'test' },
      );

      filter.catch(exception, buildHost());

      expect(capturedStatus()).toBe(404);
      const body = capturedBody() as Record<string, unknown>;
      expect(body.error).toBe('Not Found');
      expect(JSON.stringify(body)).not.toContain('operation failed');
    });

    it('maps any other Prisma error code to a safe generic 500', () => {
      const exception = new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint violated',
        { code: 'P2003', clientVersion: 'test' },
      );

      filter.catch(exception, buildHost());

      expect(capturedStatus()).toBe(500);
      expect(JSON.stringify(capturedBody())).not.toContain('Foreign key');
    });

    it('logs Prisma-error 500s server-side without exposing them to the client', () => {
      const exception = new Prisma.PrismaClientKnownRequestError('boom', {
        code: 'P2003',
        clientVersion: 'test',
      });

      filter.catch(exception, buildHost());

      expect(filter['logger'].error).toHaveBeenCalled();
    });
  });

  describe('Unknown exceptions', () => {
    it('maps an unrecognized Error to a safe generic 500 with no stack trace in the response', () => {
      const exception = new Error(
        'ENOENT: no such file or directory, open \'/etc/secret-config.json\'',
      );

      filter.catch(exception, buildHost());

      expect(capturedStatus()).toBe(500);
      const body = capturedBody() as Record<string, unknown>;
      expect(body).toEqual({
        statusCode: 500,
        message: 'An unexpected error occurred.',
        error: 'Internal Server Error',
      });
      expect(JSON.stringify(body)).not.toContain('secret-config');
      expect(JSON.stringify(body)).not.toContain('ENOENT');
    });

    it('logs the stack trace server-side for an unrecognized Error', () => {
      const exception = new Error('boom');
      filter.catch(exception, buildHost());

      expect(filter['logger'].error).toHaveBeenCalledWith(
        expect.stringContaining('500'),
        exception.stack,
      );
    });

    it('safely handles a thrown string (non-Error value) without crashing', () => {
      expect(() => filter.catch('a plain string was thrown', buildHost())).not.toThrow();
      expect(capturedStatus()).toBe(500);
    });

    it('safely handles a thrown plain object (non-Error value) without crashing', () => {
      expect(() =>
        filter.catch({ reason: 'something odd' }, buildHost()),
      ).not.toThrow();

      expect(capturedStatus()).toBe(500);
      expect(JSON.stringify(capturedBody())).not.toContain('something odd');
    });

    it('safely handles a thrown value that cannot be JSON-serialized (circular reference)', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      expect(() => filter.catch(circular, buildHost())).not.toThrow();
      expect(capturedStatus()).toBe(500);
    });

    it('safely handles undefined/null being thrown', () => {
      expect(() => filter.catch(undefined, buildHost())).not.toThrow();
      expect(capturedStatus()).toBe(500);
      expect(() => filter.catch(null, buildHost())).not.toThrow();
    });
  });

  describe('response shape consistency', () => {
    it('every filter-constructed body has exactly statusCode/message/error, matching the shape HttpException.getResponse() already produces', () => {
      filter.catch(new Error('unexpected'), buildHost());
      const body = capturedBody() as Record<string, unknown>;

      expect(Object.keys(body).sort()).toEqual(['error', 'message', 'statusCode']);
    });
  });
});
