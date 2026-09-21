import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from './env.config.js';
import {
  BoostAttempt,
  BoostEmailChange,
  BoostLevelProgress,
  BoostPasswordReset,
  BoostProfile,
  CurrencyRate,
  Customer,
  CustomerSubscription,
  CustomerQuizResult,
  CustomerQuizResultPaymentTransaction,
  EmailMarketingLog,
  EmailMarketingSetting,
  EmailMarketingStep,
  EmailTransactionalLog,
  ExternalApiLog,
  GameRun,
  MemberPointsLedger,
  User
} from '../entities/index.js';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: config.db.host,
  port: config.db.port,
  username: config.db.username,
  password: config.db.password,
  database: config.db.database,
  synchronize: config.db.synchronize,
  logging: config.db.logging,
  entities: [
    BoostAttempt,
    BoostEmailChange,
    BoostLevelProgress,
    BoostPasswordReset,
    BoostProfile,
    CurrencyRate,
    Customer,
    CustomerSubscription,
    CustomerQuizResult,
    CustomerQuizResultPaymentTransaction,
    EmailMarketingLog,
    EmailMarketingSetting,
    EmailMarketingStep,
    EmailTransactionalLog,
    ExternalApiLog,
    GameRun,
    MemberPointsLedger,
    User
  ],
  migrations: [],
  subscribers: []
});
