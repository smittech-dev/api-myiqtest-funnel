import { AppDataSource } from '../config/database.config.js';
import { CustomerQuizResult } from '../entities/CustomerQuizResult.entity.js';
import { emailTransactionalService } from './email-transactional.service.js';
import { customerEmailService } from './customer-email.service.js';
import { AppError } from '../utils/app-error.util.js';
import { EncryptionUtil } from '../utils/encryption.util.js';
import {
  EMAIL_AT_PAYMENT_FUNNEL,
  resolveFunnelRedirect,
  type FunnelRedirect
} from '../utils/funnel-redirect.util.js';
import { logger } from '../utils/logger.util.js';

export class CustomerService {
  private quizResultRepository = AppDataSource.getRepository(CustomerQuizResult);

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
   * Save the Personal Detail page: name, age, gender — and, after a wallet
   * payment, the customer's email address.
   *
   * The address is optional here because only wallet payers are asked for it:
   * a card payer typed theirs beside the card form. When it is sent it wins
   * over whatever the wallet handed over, and is applied straight away, which
   * also releases the welcome email that has been waiting for it.
   *
   * The report-ready email used to be sent from here, because saving details
   * was the last step of the funnel. In the current page order the upsell
   * comes after this page, so the report is not finished yet: the email is
   * sent once the upsell is bought or declined (see `paymentService`). Attempts
   * still on the previous order keep the old trigger.
   */
  async updateCustomerDetails(params: {
    quiz_id: string;
    first_name: string;
    last_name: string;
    age: string;
    gender?: string;
    email?: string;
  }): Promise<{
    updated: boolean;
    redirect_url: FunnelRedirect;
  }> {
    const { quiz_id, first_name, last_name, age, gender, email } = params;

    const quizResult = await this.findQuizResult(quiz_id);

    // The address first, and on its own: assigning it can move this attempt to
    // another customer and rewrite the row, so the demographics are written
    // afterwards with an update that touches only their own columns. A full
    // save of the row loaded above would put the old customer back.
    if (email) {
      await customerEmailService.assign(quizResult.id, email, 'personal_detail');
    }

    await this.quizResultRepository.update(quizResult.id, {
      first_name,
      last_name,
      age,
      // Only when it was sent, so a caller that omits it cannot blank a value
      // already stored.
      ...(gender !== undefined ? { gender } : {})
    });

    const isCurrentFunnel = (quizResult.funnel_version ?? 0) >= EMAIL_AT_PAYMENT_FUNNEL;

    if (!isCurrentFunnel) {
      // Not awaited: the customer is waiting on this response to reach their
      // next page, and a slow email provider must not hold that up. The
      // service claims a dedup row before sending and swallows every failure,
      // so a repeated save cannot produce a second email.
      void emailTransactionalService
        .sendReportReady(quizResult.id)
        .catch((err) => logger.error(`Report-ready email dispatch failed: ${err?.message ?? err}`));
    }

    const fresh = await this.quizResultRepository.findOne({
      where: { id: quizResult.id },
      relations: ['transactions']
    });

    return {
      updated: true,
      redirect_url: fresh ? resolveFunnelRedirect(fresh) : 'THANK_YOU_PAGE'
    };
  }
}

export const customerService = new CustomerService();
