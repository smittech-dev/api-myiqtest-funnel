import { Request, Response, NextFunction } from 'express';
import { adminQuizService } from '../services/admin-quiz.service.js';
import { ResponseUtil } from '../utils/api-response.util.js';
import { parseDateRange } from '../utils/date-range.util.js';
import { AdminQuizStatusFilter } from '../types/admin.types.js';

export class AdminQuizController {
  /**
   * GET /admin/quiz-submissions
   * Filters: search (quiz id or email), status, language, from, to, page, page_size
   */
  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const range = parseDateRange(
        req.query.from as string | undefined,
        req.query.to as string | undefined
      );

      const data = await adminQuizService.listSubmissions({
        search: req.query.search as string | undefined,
        status: (req.query.status as AdminQuizStatusFilter) || 'all',
        language: (req.query.language as 'all' | 'ja' | 'en') || 'all',
        page: Number(req.query.page ?? 1),
        page_size: Number(req.query.page_size ?? 10),
        from: range.from,
        to: range.to
      });

      ResponseUtil.success(res, data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /admin/quiz-submissions/:id
   * Returns the quiz, its customer, transactions, and subscriptions.
   */
  static async detail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await adminQuizService.getSubmissionDetail(req.params.id as string);
      ResponseUtil.success(res, data);
    } catch (error) {
      next(error);
    }
  }
}
