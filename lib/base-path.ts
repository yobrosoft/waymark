/** Empty in local dev. `/waymark` for the GitHub Pages project site. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function publicAsset(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_PATH}${suffix}`;
}
