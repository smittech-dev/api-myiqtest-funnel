import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/** Two states, not a workflow: unopened, or opened. See the migration's note. */
export type ContactInquiryStatus = 'new' | 'read';

/**
 * One submission of the funnel's contact form.
 *
 * Written before the admin notification is sent, so an inquiry survives a mail
 * failure — `notified_at` and `notify_error` record how that send went.
 */
@Entity('contact_inquiries')
export class ContactInquiry {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  /** The topic key from the funnel's dropdown, not its translated label. */
  @Column({ type: 'varchar', length: 50, default: 'other' })
  topic!: string;

  @Column({ type: 'text' })
  message!: string;

  /** The language to reply in. */
  @Column({ type: 'varchar', length: 5, default: 'ja' })
  language!: string;

  @Column({ type: 'varchar', length: 20, default: 'new' })
  @Index('idx_contact_inquiries_status')
  status!: ContactInquiryStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip_address!: string | null;

  /** When the admin notification left. Null means it never did. */
  @Column({ type: 'timestamptz', nullable: true })
  notified_at!: Date | null;

  /** Why it did not, when it did not. */
  @Column({ type: 'text', nullable: true })
  notify_error!: string | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  @Index('idx_contact_inquiries_created_at')
  created_at!: Date;
}
