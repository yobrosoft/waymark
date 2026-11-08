export function requestBlock(headers: Headers): string | null {
  const origin = headers.get("origin");
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (origin) {
    try {
      if (!host || new URL(origin).host !== host) {
        return "Cross-origin map requests are blocked.";
      }
    } catch {
      return "The request origin was not valid.";
    }
  }
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return "Cross-site map requests are blocked.";
  }
  return null;
}
