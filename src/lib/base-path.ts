const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function withBase(path: string): string {
  return `${BASE}${path}`;
}
