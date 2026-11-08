import http from "node:http";
import type { AddressInfo } from "node:net";
import type { WaymarkConfig } from "@/server/config";
import { browserHandler } from "@/server/browser";
import { sendText } from "@/server/http";
import type { Logger } from "@/server/log";
import { mcpHandler } from "@/server/mcp";
import type { Store } from "@/server/store";

export interface RunningServers {
  mcp: http.Server;
  tailnet: http.Server;
  start(): void;
  close(): Promise<void>;
}

export function serveWaymark(config: WaymarkConfig, store: Store, logger: Logger): RunningServers {
  const mcp = http.createServer(withLog(logger, "mcp", mcpHandler(config, store, logger)));
  const tailnet = http.createServer(withLog(logger, "tailnet", browserHandler(config, store)));
  for (const server of [mcp, tailnet]) {
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
  }
  return {
    mcp,
    tailnet,
    start() {
      mcp.listen(config.mcpPort, config.mcpHost);
      tailnet.listen(config.tailnetPort, config.tailnetHost);
    },
    close: () => Promise.all([closeServer(mcp), closeServer(tailnet)]).then(() => undefined),
  };
}

export function listenLabel(server: http.Server): string {
  const addr = server.address() as AddressInfo | null;
  return addr ? `${addr.address}:${addr.port}` : "closed";
}

function withLog(logger: Logger, side: string, handler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>) {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    const started = Date.now();
    res.on("finish", () => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      logger.info("http", {
        side,
        method: req.method || "",
        path: url.pathname,
        status: res.statusCode,
        ms: Date.now() - started,
        query: url.search.length > 0,
        origin: header(req.headers.origin),
      });
    });
    void handler(req, res).catch((err: unknown) => {
      if (res.headersSent) return;
      const status = (err as { status?: number }).status;
      if (status === 413) return sendText(res, 413, "request too large");
      sendText(res, 500, "internal error");
    });
  };
}

function header(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : String(value || "");
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}
