export type SiteRole = "member" | "admin";

export function isSiteRole(value: unknown): value is SiteRole {
  return value === "member" || value === "admin";
}
