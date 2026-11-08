export function createId(prefix: string): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export function legKey(fromStopId: string, toStopId: string): string {
  return `${fromStopId}>${toStopId}`;
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return (slug || "trip").slice(0, 60);
}
