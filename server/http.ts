import type { IncomingMessage, ServerResponse } from "node:http";

export function sendText(
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  const data = Buffer.from(body);
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "content-length": data.length,
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(data);
}

export function sendJSON(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": data.length,
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(data);
}

export function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        const err = new Error("request too large");
        (err as Error & { status?: number }).status = 413;
        req.destroy();
        fail(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", fail);
  });
}

export function bearerFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : String(header || "");
  const match = /^Bearer\s+(\S+)\s*$/i.exec(value);
  return match ? match[1] : "";
}

export function mediaType(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : String(value || "");
  return raw.split(";")[0].trim().toLowerCase();
}

export function accepts(header: string | string[] | undefined): { json: boolean; stream: boolean } {
  const raw = Array.isArray(header) ? header.join(",") : String(header || "");
  const types = raw.split(",").map((part) => part.split(";")[0].trim().toLowerCase());
  return { json: types.includes("application/json"), stream: types.includes("text/event-stream") };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
