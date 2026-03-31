//#region src/logger.d.ts
type LogLevel = "silent" | "info" | "debug";
declare class Logger {
  private level;
  constructor(level?: LogLevel);
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
//# sourceMappingURL=logger.d.ts.map
//#endregion
export { LogLevel, Logger };
//# sourceMappingURL=logger.d.cts.map