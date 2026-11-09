export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

const SEVERITY: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export function formatContext(context: LogContext): string {
  try {
    return JSON.stringify(context, (_key, value: unknown) => serialize(value));
  } catch {
    return '[unserializable context]';
  }
}

export function createLogger(minLevel: LogLevel = 'info'): Logger {
  const write = (level: LogLevel, message: string, context?: LogContext): void => {
    if (SEVERITY[level] < SEVERITY[minLevel]) return;
    const suffix = context ? ` ${formatContext(context)}` : '';
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${suffix}\n`;
    const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
    stream.write(line);
  };
  return {
    debug: (message, context) => write('debug', message, context),
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
  };
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
