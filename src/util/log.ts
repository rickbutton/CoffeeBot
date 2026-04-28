import "dotenv/config";
import { pino } from "pino";

const level = process.env.LOG_LEVEL ?? "info";

export const log =
    process.env.NODE_ENV === "production"
        ? pino({ level })
        : pino({
              level,
              transport: {
                  target: "pino-pretty",
                  options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
              },
          });
