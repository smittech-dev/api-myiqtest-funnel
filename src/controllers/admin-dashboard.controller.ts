import { Request, Response, NextFunction } from 'express';
import { adminDashboardService } from '../services/admin-dashboard.service.js';
import { ResponseUtil } from '../utils/api-response.util.js';
import { parseDateRange } from '../utils/date-range.util.js';

export class AdminDashboardController {
  /**
   * GET /admin/dashboard/stats?from=YYYY-MM-DD&to=YYYY-MM-DD
   */
  static async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const range = parseDateRange(
        req.query.from as string | undefined,
        req.query.to as string | undefined
      );
      const data = await adminDashboardService.getStats(range);
      ResponseUtil.success(res, data);
    } catch (error) {
      next(error);
    }
  }
}
