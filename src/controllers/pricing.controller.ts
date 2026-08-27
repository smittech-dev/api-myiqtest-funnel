import { Request, Response, NextFunction } from 'express';
import { pricingService } from '../services/pricing.service.js';
import { ResponseUtil } from '../utils/api-response.util.js';

export class PricingController {
  /**
   * GET /price?language=ja&price_dis=20
   */
  static getPrice(req: Request, res: Response, next: NextFunction): void {
    try {
      const language = (req.query.language as string) || (req.query.lang as string) || 'ja';
      const discountCode = (req.query.price_dis as string) || null;

      const data = pricingService.getPricing(language, discountCode);
      ResponseUtil.success(res, data);
    } catch (error) {
      next(error);
    }
  }
}
