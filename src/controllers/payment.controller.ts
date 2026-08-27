import { Request, Response, NextFunction } from 'express';
import { paymentService } from '../services/payment.service.js';
import { ResponseUtil } from '../utils/api-response.util.js';
import { AppError } from '../utils/app-error.util.js';

export class PaymentController {
  /**
   * POST /api/v1/payment/stripe/first-sale/create-payment-intent
   */
  static async createFirstSalePaymentIntent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await paymentService.createFirstSalePaymentIntent(req.body);
      ResponseUtil.success(res, data, 'First sale payment intent created successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /payment/first-sale/payments/confirm
   */
  static async confirmFirstSalePayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await paymentService.confirmFirstSalePayment(req.body);
      ResponseUtil.success(res, data, 'First sale payment confirmation processed');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /payment/cross-sale/confirm
   */
  static async confirmCrossSalePayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await paymentService.confirmCrossSalePayment(req.body);
      ResponseUtil.success(res, data, 'Cross-sale payment processed');
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/payment/stripe/webhook
   */
  static async handleWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sig = req.headers['stripe-signature'] as string;
      if (!sig) {
        throw new AppError('Missing Stripe signature header', 400);
      }

      const result = await paymentService.handleWebhook(req.body, sig);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
