import { destination, pino, stdSerializers, type DestinationStream, type Logger } from "pino";

export function createLogger(dest: DestinationStream = destination({ sync: true })): Logger {
  return pino(
    { level: "debug", base: null, timestamp: false, formatters: { level: (label) => ({ level: label }) }, serializers: { err: stdSerializers.err, error: stdSerializers.err } },
    dest,
  );
}

export const log = createLogger();
