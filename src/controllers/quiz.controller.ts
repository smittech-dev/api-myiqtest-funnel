import { isIP } from 'net';
import { Request, Response, NextFunction } from 'express';
import { quizService } from '../services/quiz.service.js';
import { ResponseUtil } from '../utils/api-response.util.js';

export class QuizController {
  /**
   * POST /api/v1/questions/submit
   */
  static async submitQuiz(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Not the raw X-Forwarded-For: behind Cloudflare and nginx that is a list
      // ("client, cf-edge"), and its first entry is whatever the client sent.
      // `req.ip` picks one address; anything that is not an IP is dropped.
      const ip = req.ip;
      const ipAddress = ip && isIP(ip) ? ip : undefined;
      const data = await quizService.submitQuiz(req.body, ipAddress);
      ResponseUtil.success(res, data, 'Quiz submitted successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /questions/results?quiz_id=<encrypted_quiz_id>
   */
  static async getQuizResults(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const quizId = req.query.quiz_id as string;
      const data = await quizService.getQuizResults(quizId);
      ResponseUtil.success(res, data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /questions/report?quiz_id=<encrypted_quiz_id>
   */
  static async getQuizReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const quizId = req.query.quiz_id as string;
      const data = await quizService.getQuizReport(quizId);
      ResponseUtil.success(res, data);
    } catch (error) {
      next(error);
    }
  }
}
