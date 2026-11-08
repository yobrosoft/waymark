import type { Writable } from "node:stream";

export interface Logger {
  info(message: string, fields?: Record<string, string | number | boolean>): void;
}

export function createLogger(stream: Writable): Logger {
  return {
    info(message, fields = {}) {
      stream.write(`${JSON.stringify({ time: new Date().toISOString(), msg: message, ...fields })}\n`);
    },
  };
}
