export function googleClientID(config: { googleClientId?: unknown } | null, env = ""): string {
  const fromFile = typeof config?.googleClientId === "string" ? config.googleClientId.trim() : "";
  return fromFile || env.trim();
}

export async function loadGoogleClientID(): Promise<string> {
  const env = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
  try {
    const response = await fetch("/config.json", { cache: "no-store" });
    if (response.ok) {
      const body = (await response.json()) as { googleClientId?: unknown };
      return googleClientID(body, env);
    }
  } catch {
    /* Local dev has no config file. */
  }
  return googleClientID(null, env);
}
