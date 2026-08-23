/**
 * Public member catalog.
 *
 * One entry per member page, served at `/m/<slug>` on the apex. Like
 * `projects.ts`, this is the public mirror of a private governance registry:
 * approved facts are copied here via reviewed pull request, and there is no
 * runtime coupling between the two.
 *
 * Content integrity rule (WEBSITE.md §10): every value below must be a recorded
 * fact. A member who has not supplied a blurb, a website, or a showcase is
 * represented by omission — never by rendering "TBD", a placeholder bio, or a
 * guessed URL. The page is designed to read correctly when only `slug` and
 * `name` are known.
 */

import { PROJECTS, type Project, type ProjectStatus } from "@/data/projects";

/**
 * A member's showcase, in the two shapes a member can supply.
 *
 * `project` points at an entry in `PROJECTS`, so a HAM project's name, status,
 * and artwork stay recorded in exactly one place. `external` carries its own
 * facts, for a personal project that is not on the HAM shelf.
 */
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
      artwork?: { src: string; alt: string };
    };

export interface Member {
  /**
   * Identifies the member in `/m/<slug>`, and is the subdomain label they are
   * given for their own site. Must satisfy `isValidMemberSlug` — it ends up a
   * DNS label, so the constraints are RFC 1123's, not merely "URL-safe".
   */
  slug: string;
  /** Display name, as the member writes it. Case is preserved. */
  name: string;
  /** One or two sentences in the member's own words. */
  blurb?: string;
  /**
   * The member's own site. Absolute https URL.
   *
   * Usually `https://<slug>.teamham.world`, which they point at whatever they
   * deploy — but it is recorded, not derived, because a member may prefer their
   * own domain and some will have no site at all.
   */
  website?: string;
  showcase?: MemberShowcase;
}

/**
 * Labels the apex needs for itself, which therefore can never be a member.
 *
 * A member's slug is a path segment here, but it is also the subdomain the
 * member is given to point at their own deployment. Handing someone `www` or
 * `api` would mean carving a hole in the apex's own DNS, so the catalog refuses
 * those slugs up front rather than discovering the clash at delegation time.
 *
 * STANDING RULE — read this before registering a game OAuth client. The
 * `redirect_uri` CHECK in `migrations/0002_game_backend_authorization.sql`
 * accepts any `*.teamham.world` host, which was written when every subdomain
 * was HAM-controlled. Now that subdomains are delegated to members, a client's
 * redirect host is only safe if its label can never be handed to a member — so
 * **the host label of every game OAuth client must appear in this set before
 * the client row is inserted.** Nothing in the app can enforce that: the
 * runtime role holds `SELECT` alone on `game_oauth_clients`, so registration
 * happens outside this codebase. The list below is the enforcement.
 *
 * Over-reserving is close to free — it only narrows the pool of available
 * member slugs — so the auth- and game-shaped labels are reserved ahead of
 * anything claiming them.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  // Auth surfaces and anything that could receive an OAuth redirect.
  "account",
  "accounts",
  "auth",
  "id",
  "login",
  "oauth",
  "sso",
  "token",

  // Game hosts. A game OAuth client's redirect host must be one of these.
  "arcade",
  "game",
  "games",
  "play",
  "puff",
  "quiz",

  // Site and infrastructure.
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

/**
 * RFC 1123 host label: lowercase alphanumerics and hyphens, 1–63 characters,
 * no leading or trailing hyphen.
 */
const MEMBER_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidMemberSlug(slug: string): boolean {
  return MEMBER_SLUG_REGEX.test(slug) && !RESERVED_SUBDOMAINS.has(slug);
}

/** The render shape both showcase kinds collapse to. */
export interface ResolvedShowcase {
  name: string;
  shortDescription: string;
  type: string;
  status: ProjectStatus;
  publicUrl?: string;
  repository?: string;
  artwork?: { src: string; alt: string };
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

/**
 * Normalize a member's showcase for rendering.
 *
 * Returns `null` when the member has none, and also when a `project` reference
 * names a slug that is not in `PROJECTS` — a dangling reference degrades to no
 * showcase rather than to a half-rendered card. `members.test.ts` asserts no
 * such reference is committed, so this path is a runtime backstop, not the
 * expected case.
 */
export function resolveShowcase(member: Member): ResolvedShowcase | null {
  const { showcase } = member;
  if (!showcase) {
    return null;
  }

  if (showcase.kind === "project") {
    const project = PROJECTS.find((p) => p.slug === showcase.projectSlug);
    return project ? resolveProjectShowcase(project) : null;
  }

  return {
    name: showcase.name,
    shortDescription: showcase.shortDescription,
    type: showcase.type,
    status: showcase.status,
    publicUrl: showcase.url,
    repository: showcase.repository,
    artwork: showcase.artwork,
  };
}

export const MEMBERS: Member[] = [
  {
    // Only the recorded facts. `blurb`, `website`, and `showcase` are omitted
    // until CyR1en supplies them — see the content integrity rule above.
    slug: "cyr1en",
    name: "CyR1en",
  },
];

export function findMember(slug: string): Member | undefined {
  return MEMBERS.find((member) => member.slug === slug);
}
