import type { Request } from 'express';
import { config } from '../config/env.config.js';
import type { QuizLocale } from './boost-engine.util.js';

/**
 * Language, for the members' app.
 *
 * The app is served in English at the root and in Japanese under `/ja` — the
 * same scheme as the funnel — and tells the API which one it is showing with
 * `Accept-Language` on every call.
 */

export type BoostLocale = QuizLocale;

/**
 * The language the app is showing, from `Accept-Language`.
 *
 * The app sends a single tag (`ja` or `en`). Only the first tag is read, so a
 * browser's own list (`ja,en-US;q=0.9`) resolves the same way. Anything that
 * is not Japanese is English, the app's default.
 */
export function requestLocale(req: Request): BoostLocale {
  const first = (req.get('accept-language') ?? '').split(',')[0].trim().toLowerCase();
  return first === 'ja' || first.startsWith('ja-') ? 'ja' : 'en';
}

const appBase = (): string => config.boost.appUrl.replace(/\/+$/, '');

/** A page of the members' app in `locale`: `/reset-password` → `…/ja/reset-password`. */
export function boostAppUrl(path: string, locale: string): string {
  return `${appBase()}${locale === 'ja' ? '/ja' : ''}${path}`;
}

/**
 * A full URL into the members' app (BRAIN_TRAINING_LOGIN_URL, say), moved to
 * its Japanese page for a Japanese reader. A URL on any other host — the
 * funnel fallback — or one already under `/ja` is returned unchanged.
 */
export function inBoostLocale(url: string, locale: string): string {
  if (locale !== 'ja' || !url) return url;
  try {
    const target = new URL(url);
    const app = new URL(appBase());
    if (target.host !== app.host) return url;

    const prefix = app.pathname.replace(/\/+$/, '');
    if (!target.pathname.startsWith(prefix)) return url;
    const rest = target.pathname.slice(prefix.length) || '/';
    if (/^\/ja(\/|$)/.test(rest)) return url;

    target.pathname = `${prefix}/ja${rest === '/' ? '' : rest}`;
    return target.toString();
  } catch {
    return url;
  }
}
