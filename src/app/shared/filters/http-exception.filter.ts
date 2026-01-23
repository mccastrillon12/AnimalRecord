import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainError } from '../../../context/shared/domain/DomainError';
import { InvalidArgumentError } from '../../../context/shared/domain/errors/InvalidArgumentError';
import { ResourceNotFoundError } from '../../../context/shared/domain/errors/ResourceNotFoundError';
import { ConflictError } from '../../../context/shared/domain/errors/ConflictError';
import { InvalidCredentialsError } from '../../../context/shared/domain/errors/InvalidCredentialsError';
import { UserNotVerifiedError } from '../../../context/shared/domain/errors/UserNotVerifiedError';

@Catch(Error)
export class HttpExceptionFilter implements ExceptionFilter {
    catch(exception: Error, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let message = 'Internal server error';

        if (exception instanceof DomainError) {
            if (exception instanceof InvalidArgumentError) {
                status = HttpStatus.BAD_REQUEST;
            } else if (exception instanceof ResourceNotFoundError) {
                status = HttpStatus.NOT_FOUND;
            } else if (exception instanceof ConflictError) {
                status = HttpStatus.CONFLICT;
            } else if (exception instanceof InvalidCredentialsError) {
                status = HttpStatus.UNAUTHORIZED;
            } else if (exception instanceof UserNotVerifiedError) {
                status = HttpStatus.FORBIDDEN;
            } else {
                status = HttpStatus.BAD_REQUEST;
            }
            message = exception.message;
        } else if (exception instanceof HttpException) {
            status = exception.getStatus();
            message = exception.message;
        } else {
            console.error(exception);
        }

        response
            .status(status)
            .json({
                statusCode: status,
                message: message,
                path: request.url,
                timestamp: new Date().toISOString(),
                ...(exception instanceof UserNotVerifiedError && exception.timeRemaining ? { timeRemaining: exception.timeRemaining } : {})
            });
    }
}
