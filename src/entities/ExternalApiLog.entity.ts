import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index
} from 'typeorm';

@Entity('external_api_logs')
export class ExternalApiLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  @Index('idx_external_api_logs_service')
  service_name!: string;

  @Column({ type: 'varchar', length: 255 })
  endpoint!: string;

  @Column({ type: 'varchar', length: 10 })
  method!: string;

  @Column({ type: 'integer', nullable: true })
  status_code!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  request_payload!: Record<string, any> | null;

  @Column({ type: 'jsonb', nullable: true })
  response_payload!: Record<string, any> | null;

  @Column({ type: 'boolean', default: false })
  @Index('idx_external_api_logs_is_error')
  is_error!: boolean;

  @Column({ type: 'text', nullable: true })
  error_message!: string | null;

  @Column({ type: 'integer', nullable: true })
  duration_ms!: number | null;

  @CreateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;
}
