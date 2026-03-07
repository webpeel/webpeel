/**
 * Lightweight structured logger — no external dependencies.
 *
 * Levels: debug < info < warn < error < silent
 *
 * Respects WEBPEEL_LOG_LEVEL env var.
 * Defaults: production → 'info', development → 'debug'.
 *
 * All output goes to stderr so stdout stays clean for data/JSON (CLI piping).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const currentLevel = (): LogLevel => {
  const env = process.env.WEBPEEL_LOG_LEVEL?.toLowerCase() as LogLevel;
  if (env && env in LEVELS) return env;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
};

export function createLogger(module: string) {
  const prefix = `[webpeel:${module}]`;

  return {
    debug: (...args: any[]) => {
      if (LEVELS[currentLevel()] <= LEVELS.debug) console.error(prefix, ...args);
    },
    info: (...args: any[]) => {
      if (LEVELS[currentLevel()] <= LEVELS.info) console.error(prefix, ...args);
    },
    warn: (...args: any[]) => {
      if (LEVELS[currentLevel()] <= LEVELS.warn) console.error(prefix, '[WARN]', ...args);
    },
    error: (...args: any[]) => {
      if (LEVELS[currentLevel()] <= LEVELS.error) console.error(prefix, '[ERROR]', ...args);
    },
  };
}
