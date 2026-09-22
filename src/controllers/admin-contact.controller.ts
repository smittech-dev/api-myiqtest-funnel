import { Request, Response, NextFunction } from 'express';
import { contactService } from '../services/contact.service.js';
import { ResponseUtil } from '../utils/api-response.util.js';
import { parseDateRange } from '../utils/date-range.util.js';
import { AdminContactStatusFilter } from '../types/admin.types.js';

export class AdminContactController {
  /**
   * GET /admin/contact-inquiries
   * Filters: search (name, email or message), status, topic, from, to, page, page_size
   */
  static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const range = parseDateRange(
        req.query.from as string | undefined,
        req.query.to as string | undefined
      );

      const [result, unread] = await Promise.all([
        contactService.list({
          search: req.query.search as string | undefined,
          status: (req.query.status as AdminContactStatusFilter) || 'all',
          topic: (req.query.topic as string) || 'all',
          page: Number(req.query.page ?? 1),
          page_size: Number(req.query.page_size ?? 20),
          from: range.from,
          to: range.to
        }),
        // Counted unfiltered on purpose: "3 unread" has to mean the same thing
        // whatever filter the operator happens to be looking through.
        contactService.countNew()
      ]);

      ResponseUtil.success(res, { ...result, unread });
    } catch (error) {
      next(error);
    }
  }

  /** GET /admin/contact-inquiries/:id */
  static async detail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await contactService.get(req.params.id as string);
      ResponseUtil.success(res, data);
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /admin/contact-inquiries/:id — flips it between new and read. */
  static async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await contactService.setStatus(req.params.id as string, req.body.status);
      ResponseUtil.success(res, data, 'Inquiry updated');
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /admin/contact-inquiries/:id — for clearing out spam. */
  static async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await contactService.remove(req.params.id as string);
      ResponseUtil.success(res, null, 'Inquiry deleted');
    } catch (error) {
      next(error);
    }
  }
}
