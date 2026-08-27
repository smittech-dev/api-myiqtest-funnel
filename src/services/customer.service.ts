import { AppDataSource } from '../config/database.config.js';
import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';
import { Customer } from '../entities/Customer.entity.js';
import { emailTransactionalService } from './email-transactional.service.js';
import { AppError } from '../utils/app-error.util.js';
import { EncryptionUtil } from '../utils/encryption.util.js';
import { logger } from '../utils/logger.util.js';

export class CustomerService {
  private quizResultRepository = AppDataSource.getRepository(CustomerQuizResult);
  private customerRepository = AppDataSource.getRepository(Customer);

  private async findQuizResult(identifier: string): Promise<CustomerQuizResult> {
    let numericId: string;
    try {
      numericId = EncryptionUtil.decryptId(identifier);
    } catch {
      throw new AppError('Invalid quiz_id', 400);
    }

    const res = await this.quizResultRepository.findOne({
      where: { id: numericId },
      relations: ['transactions', 'customer']
    });

    if (!res) {
      throw new AppError('Quiz result not found', 404);
    }
    return res;
  }

  /**
   * Update customer demographic/personal details
   *
   * This is also the end of the funnel: saving a first and last name is what
   * moves `resolveFunnelRedirect` to THANK_YOU_PAGE, so it is the moment the
   * report is genuinely finished — the certificate has a name on it and the
   * cross-sale has been either bought or declined. That makes it the right
   * trigger for the report-ready email, and the only one: sending on payment
   * instead would mean the message could never mention the cross-sale report,
   * because the upsell comes after the first sale in the funnel.
   */
  async updateCustomerDetails(params: {
    quiz_id: string;
    first_name: string;
    last_name: string;
    age: string;
  }): Promise<{
    updated: boolean;
  }> {
    const { quiz_id, first_name, last_name, age } = params;

    const quizResult = await this.findQuizResult(quiz_id);

    quizResult.first_name = first_name;
    quizResult.last_name = last_name;
    quizResult.age = age;
    await this.quizResultRepository.save(quizResult);

    // Not awaited: the customer is waiting on this response to reach their
    // thank-you page, and a slow email provider must not hold that up. The
    // service claims a dedup row before sending and swallows every failure, so
    // a repeated save cannot produce a second email.
    void emailTransactionalService
      .sendReportReady(quizResult.id)
      .catch((err) => logger.error(`Report-ready email dispatch failed: ${err?.message ?? err}`));

    return {
      updated: true
    };
  }
}

export const customerService = new CustomerService();
