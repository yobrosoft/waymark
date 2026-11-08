import { loadConfig } from "@/server/config";
import { listenLabel, serveWaymark } from "@/server/app";
import { createLogger } from "@/server/log";
import { createStore } from "@/server/store";

const logger = createLogger(process.stderr);

let config;
try {
  config = loadConfig();
} catch (err) {
  logger.info("fatal", { error: err instanceof Error ? err.message : "config error" });
  process.exit(1);
}

const store = createStore(config.dataFile, config.proposalIntervalMs);
const running = serveWaymark(config, store, logger);

function listening(server: typeof running.mcp, side: string) {
  server.on("listening", () => logger.info("listening", { side, addr: listenLabel(server) }));
  server.on("error", () => {
    logger.info("fatal", { error: "listen failed", side });
    process.exit(1);
  });
}

listening(running.mcp, "mcp");
listening(running.tailnet, "tailnet");
running.start();

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  void running.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
