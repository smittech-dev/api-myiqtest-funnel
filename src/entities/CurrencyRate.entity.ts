import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('currency_rates')
export class CurrencyRate {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 3, unique: true })
  currency_code!: string;

  @Column({ type: 'numeric', precision: 15, scale: 6 })
  rate_to_gbp!: string;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  updated_at!: Date;
}
