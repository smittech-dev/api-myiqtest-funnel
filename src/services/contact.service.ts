import { Brackets } from 'typeorm';
import { AppDataSource } from '../config/database.config.js';
import { config } from '../config/env.config.js';
import { createEmailContext } from '../emails/context.js';
import { contactTopicLabel } from '../emails/templates/contact.templates.js';
import { ContactInquiry } from '../entities/ContactInquiry.entity.js';
import { AppError } from '../utils/app-error.util.js';
import { logger } from '../utils/logger.util.js';
import { emailService } from './email.service.js';
import type {
  AdminContactListQuery,
  AdminPaginatedResult
} from '../types/admin.types.js';

const TEMPLATE_ID = 'contact_inquiry_admin';

export interface CreateContactInquiryInput {
  name: string;
  email: string;
  topic: string;
  message: string;
  language: 'ja' | 'en';
  /** Best-effort; null when the request arrived without a usable address. */
  ip_address?: string | null;
}

export class ContactService {
  private repository = AppDataSource.getRepository(ContactInquiry);

  /**
   * Stores one submission, then notifies the admin address.
   *
   * In that order, and the notification is awaited but never allowed to fail
   * the request. The visitor's part is done once the row exists: telling them
   * their message did not go through, because *our* mail provider was having a
   * bad minute, would lose a message that is already safely saved. The failure
   * is recorded on the row instead, where an operator can see it.
   */
  async create(input: CreateContactInquiryInput): Promise<{ id: string }> {
    const inquiry = this.repository.create({
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      topic: input.topic,
      message: input.message.trim(),
      language: input.language,
      status: 'new',
      ip_address: input.ip_address ?? null
    });

    const saved = await this.repository.save(inquiry);

    await this.notifyAdmin(saved);

    return { id: String(saved.id) };
  }

  /**
   * Emails every configured admin address about one inquiry, and records how
   * that went on the row.
   *
   * Each address is sent to separately rather than as one multi-recipient
   * message, so a single dead address in the list does not cost the others
   * their copy — and so the error that comes back names which one failed.
   */
  private async notifyAdmin(inquiry: ContactInquiry): Promise<void> {
    const recipients = config.contact.adminEmails;

    if (recipients.length === 0) {
      logger.warn(
        `Contact inquiry #${inquiry.id} saved but nobody was notified: CONTACT_ADMIN_EMAIL is not set.`
      );
      await this.repository.update(inquiry.id, {
        notify_error: 'CONTACT_ADMIN_EMAIL is not set.'
      });
      return;
    }

    const context = createEmailContext(
      // The admin notification is written in English whatever the visitor used;
      // their language travels as `contact_language`, which is what the reply
      // needs. See src/emails/templates/contact.templates.ts.
      { email: recipients[0]!, language: 'en', site_url: config.funnelUrl },
      {
        contact_id: String(inquiry.id),
        contact_name: inquiry.name,
        contact_email: inquiry.email,
        contact_topic: contactTopicLabel(inquiry.topic),
        contact_message: inquiry.message,
        contact_language: inquiry.language,
        contact_submitted_at: inquiry.created_at.toISOString()
      }
    );

    const results = await Promise.all(
      recipients.map(async (to) => {
        const result = await emailService.send({ templateId: TEMPLATE_ID, to, context });
        return { to, result };
      })
    );

    const delivered = results.some(({ result }) => result.status === 'sent');
    const problems = results.flatMap(({ to, result }) => {
      if (result.status === 'failed') return [`${to}: ${result.error}`];
      if (result.status === 'skipped') return [`${to}: ${result.reason}`];
      return [];
    });

    if (problems.length > 0) {
      logger.warn(`Contact inquiry #${inquiry.id} notification problems — ${problems.join('; ')}`);
    }

    await this.repository.update(inquiry.id, {
      notified_at: delivered ? new Date() : null,
      notify_error: problems.length > 0 ? problems.join('; ') : null
    });
  }

  /** The admin list: newest first, filtered by status, topic, search and date. */
  async list(query: AdminContactListQuery): Promise<AdminPaginatedResult<ContactInquiry>> {
    const { search, status = 'all', topic = 'all', page, page_size, from, to } = query;

    const qb = this.repository.createQueryBuilder('inquiry');

    if (from) qb.andWhere('inquiry.created_at >= :from', { from });
    if (to) qb.andWhere('inquiry.created_at <= :to', { to });
    if (status !== 'all') qb.andWhere('inquiry.status = :status', { status });
    if (topic !== 'all') qb.andWhere('inquiry.topic = :topic', { topic });

    const term = search?.trim();
    if (term) {
      // One box over name, address and body — which is how somebody looks for
      // "that message about the refund" when they remember a word of it and
      // nothing else.
      qb.andWhere(
        new Brackets((w) => {
          w.where('inquiry.email ILIKE :term', { term: `%${term}%` })
            .orWhere('inquiry.name ILIKE :term', { term: `%${term}%` })
            .orWhere('inquiry.message ILIKE :term', { term: `%${term}%` });
        })
      );
    }

    qb.orderBy('inquiry.created_at', 'DESC')
      .addOrderBy('inquiry.id', 'DESC')
      .skip((page - 1) * page_size)
      .take(page_size);

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      total,
      page,
      page_size,
      total_pages: Math.max(1, Math.ceil(total / page_size))
    };
  }

  /** How many are still unopened — the badge on the sidebar. */
  async countNew(): Promise<number> {
    return this.repository.count({ where: { status: 'new' } });
  }

  async get(id: string): Promise<ContactInquiry> {
    const inquiry = await this.repository.findOne({ where: { id } });
    if (!inquiry) {
      throw new AppError(`Contact inquiry ${id} not found`, 404);
    }
    return inquiry;
  }

  /** Marks one inquiry opened or unopened. */
  async setStatus(id: string, status: 'new' | 'read'): Promise<ContactInquiry> {
    const inquiry = await this.get(id);

    if (inquiry.status !== status) {
      inquiry.status = status;
      await this.repository.update(id, { status });
    }

    return inquiry;
  }

  async remove(id: string): Promise<void> {
    // Read first, so deleting something that is not there answers 404 rather
    // than reporting a success that deleted nothing.
    await this.get(id);
    await this.repository.delete(id);
  }
}

export const contactService = new ContactService();
