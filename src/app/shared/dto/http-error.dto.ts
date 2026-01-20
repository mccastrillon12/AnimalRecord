import { ApiProperty } from '@nestjs/swagger';

export class HttpErrorDto {
    @ApiProperty({ example: 400, description: 'HTTP Status Code' })
    statusCode: number;

    @ApiProperty({ example: 'Bad Request', description: 'Error message or description' })
    message: string | string[];

    @ApiProperty({ example: '/api/endpoint', description: 'Request path yielding the error' })
    path: string;

    @ApiProperty({ example: '2026-01-19T18:00:00.000Z', description: 'Timestamp of the error' })
    timestamp: string;
}
