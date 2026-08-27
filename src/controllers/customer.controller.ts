import { Request, Response, NextFunction } from 'express';
import { customerService } from '../services/customer.service.js';
import { ResponseUtil } from '../utils/api-response.util.js';

export class CustomerController {
  /**
   * PUT /customer/update
   */
  static async updateCustomer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await customerService.updateCustomerDetails(req.body);
      ResponseUtil.success(res, data, 'Customer details updated successfully');
    } catch (error) {
      next(error);
    }
  }
}
