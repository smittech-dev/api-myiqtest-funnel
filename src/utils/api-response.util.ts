import { Response } from 'express';
import { ApiResponse } from '../types/api-response.types.js';

export class ResponseUtil {
  static success<T>(res: Response, data: T, message?: string, statusCode = 200): Response {
    const payload: ApiResponse<T> = {
      success: true,
      data,
      ...(message && { message })
    };
    return res.status(statusCode).json(payload);
  }

  static error(res: Response, message: string, statusCode = 500, details?: any): Response {
    const payload: ApiResponse = {
      success: false,
      error: {
        message,
        ...(details && { details })
      }
    };
    return res.status(statusCode).json(payload);
  }
}
