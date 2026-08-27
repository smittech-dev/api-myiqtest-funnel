import { AppDataSource } from '../config/database.config.js';
import { ExternalApiLog } from '../entities/ExternalApiLog.entity.js';
import { logger } from '../utils/logger.util.js';

export class ExternalApiLogService {
  private logRepository = AppDataSource.getRepository(ExternalApiLog);

  async log(params: {
    service_name: string;
    endpoint: string;
    method: string;
    status_code?: number;
    request_payload?: any;
    response_payload?: any;
    is_error?: boolean;
    error_message?: string;
    duration_ms?: number;
  }): Promise<void> {
    try {
      const logEntry = this.logRepository.create({
        service_name: params.service_name,
        endpoint: params.endpoint,
        method: params.method,
        status_code: params.status_code ?? null,
        request_payload: params.request_payload ?? null,
        response_payload: params.response_payload ?? null,
        is_error: params.is_error ?? false,
        error_message: params.error_message ?? null,
        duration_ms: params.duration_ms ?? null
      });

      await this.logRepository.save(logEntry);
    } catch (err) {
      // Don't let logging failures crash the request
      logger.error('Failed to write external API log:', err);
    }
  }
}

export const externalApiLogService = new ExternalApiLogService();
