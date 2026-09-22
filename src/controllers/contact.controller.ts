import { Request, Response, NextFunction } from 'express';
import { contactService } from '../services/contact.service.js';
import { ResponseUtil } from '../utils/api-response.util.js';

export class ContactController {
  /**
   * POST /contact
   *
   * Public — reached from the funnel's contact page. Answers with the stored
   * id and nothing else: the visitor has no use for the row, and echoing back
   * what they typed is a reflection surface for no benefit.
   */
  static async submit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = await contactService.create({
        name: req.body.name,
        email: req.body.email,
        topic: req.body.topic,
        message: req.body.message,
        language: req.body.language,
        ip_address: req.ip ?? null
      });

      ResponseUtil.success(res, data, 'Your message has been received', 201);
    } catch (error) {
      next(error);
    }
  }
}
