import { PROJECTS, type Project, type ProjectStatus } from "@/data/projects";

export type MemberShowcase =
  | { kind: "project"; projectSlug: string }
  | {
      kind: "external";
      name: string;
      shortDescription: string;
      type: string;
      status: ProjectStatus;
      url?: string;
      repository?: string;
      imageUrl?: string;
    };

export interface MemberPublicPage {
  slug: string;
  displayName: string;
  blurb: string | null;
  websiteUrl: string | null;
  showcase: MemberShowcase | null;
}

export interface MemberDirectoryItem {
  slug: string;
  displayName: string;
  blurb: string | null;
}

export interface ResolvedShowcase {
  name: string;
  shortDescription: string;
  type: string;
  status: ProjectStatus;
  publicUrl?: string;
  repository?: string;
  artwork?: { src: string; alt: string; remote?: boolean };
}

/**
 * Apex, auth, infrastructure, and game labels that cannot be delegated to a
 * member. Add a game OAuth client's host label here before registering it.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "account",
  "accounts",
  "auth",
  "id",
  "login",
  "oauth",
  "sso",
  "token",
  "arcade",
  "game",
  "games",
  "play",
  "puff",
  "quiz",
  "admin",
  "api",
  "app",
  "assets",
  "beta",
  "blog",
  "cdn",
  "demo",
  "dev",
  "docs",
  "files",
  "ftp",
  "git",
  "imap",
  "internal",
  "localhost",
  "mail",
  "media",
  "members",
  "mx",
  "ns",
  "ns1",
  "ns2",
  "pop",
  "preview",
  "sandbox",
  "smtp",
  "staging",
  "static",
  "status",
  "support",
  "teamham",
  "test",
  "webmail",
  "www",
]);

const MEMBER_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidMemberSlug(slug: string): boolean {
  return MEMBER_SLUG_REGEX.test(slug) && !RESERVED_SUBDOMAINS.has(slug);
}

function resolveProjectShowcase(project: Project): ResolvedShowcase {
  return {
    name: project.name,
    shortDescription: project.shortDescription,
    type: project.type,
    status: project.status,
    publicUrl: project.links?.publicUrl,
    repository: project.links?.repository,
    artwork: project.artwork,
  };
}

export function resolveShowcase(
  showcase: MemberShowcase | null,
): ResolvedShowcase | null {
  if (!showcase) return null;

  if (showcase.kind === "project") {
    const project = PROJECTS.find((item) => item.slug === showcase.projectSlug);
    return project ? resolveProjectShowcase(project) : null;
  }

  return {
    name: showcase.name,
    shortDescription: showcase.shortDescription,
    type: showcase.type,
    status: showcase.status,
    publicUrl: showcase.url,
    repository: showcase.repository,
    artwork: showcase.imageUrl
      ? {
          src: showcase.imageUrl,
          alt: `${showcase.name} showcase artwork`,
          remote: true,
        }
      : undefined,
  };
}
