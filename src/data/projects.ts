/**
 * Public project catalog.
 *
 * `organization-docs/PROJECTS.md` is the private governance registry; approved
 * facts are copied here via reviewed pull request. There is no runtime coupling
 * between the two.
 *
 * Content integrity rule (WEBSITE.md §10): every value below must be a recorded
 * fact. Unknown fields are represented by omission or an empty array — never by
 * rendering "TBD", "Unassigned", or "null" in the public UI.
 */

export type ProjectStatus =
  | "planning"
  | "in-development"
  | "playable"
  | "released"
  | "paused"
  | "retired";

/** Approved uppercase display labels for each status code (BRAND.md §3). */
export const STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "IN PLANNING",
  "in-development": "IN DEVELOPMENT",
  playable: "PLAYABLE",
  released: "RELEASED",
  paused: "PAUSED",
  retired: "RETIRED",
};

export interface Project {
  slug: string;
  name: string;
  shortDescription: string;
  type: string;
  status: ProjectStatus;
  makers: string[];
  featured: boolean;
  links?: {
    repository?: string;
    publicUrl?: string;
  };
  artwork?: {
    src: string;
    alt: string;
  };
  longDescription?: string;
}

/**
 * The disclosure content gate.
 *
 * A shelf entry only grows an expansion trigger when there is approved content
 * to reveal. An empty disclosure panel must never render.
 */
export function hasExpandableContent(project: Project): boolean {
  return Boolean(
    project.longDescription ||
      project.makers.length > 0 ||
      project.links?.repository ||
      project.links?.publicUrl,
  );
}

export const PROJECTS: Project[] = [
  {
    slug: "pusoy",
    name: "Pusoy Dos",
    shortDescription:
      "The Filipino shedding game for four to six players. Deal a private table with friends, or practice against bots.",
    type: "game",
    status: "playable",
    makers: [],
    featured: false,
    links: {
      publicUrl: "https://pusoy.teamham.world",
    },
    artwork: {
      src: "/project-art/pusoy-v1.jpg",
      alt: "Pusoy Dos by HAM: 4–6 players. One table. Tara, laro! A fanned hand of playing cards.",
    },
  },
  {
    slug: "strokies",
    name: "strokies.",
    shortDescription:
      "Bad drawings. Great company. Draw, guess, and laugh with your friends in this multiplayer drawing and guessing game.",
    type: "game",
    status: "playable",
    makers: [],
    featured: false,
    links: {
      publicUrl: "https://strokies.teamham.world",
    },
    artwork: {
      src: "/project-art/strokies-v1.jpg",
      alt: "Strokies: Bad drawings. Great company. Laughing friends and a goofy cat drawing.",
    },
  },
  {
    // Provisional slug — must be finalized before any external sharing.
    slug: "untitled-quiz-show",
    name: "Untitled quiz-show game",
    shortDescription:
      "A modern and fair quiz-show game inspired by Jeopardy (the eventual product and domain name will not use \"Jeopardy\").",
    type: "game",
    status: "planning",
    makers: [],
    featured: false,
  },
];
