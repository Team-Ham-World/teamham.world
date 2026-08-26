import type { ProjectListBlock } from "@/lib/members/v2/document";
import type { AssetMetadata } from "../MemberPageV2View";

import {
  MemberPageV2ProjectCard,
  resolveMemberPageProject,
  type ResolvedMemberPageProject,
} from "./MemberPageV2Project";

interface MemberPageV2ProjectListProps {
  block: ProjectListBlock;
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
}

export function MemberPageV2ProjectList({
  block,
  assetMetadata,
}: MemberPageV2ProjectListProps) {
  const resolved = block.projects
    .map((entry) => ({
      id: entry.id,
      project: resolveMemberPageProject(entry.project, assetMetadata),
    }))
    .filter(
      (entry): entry is { id: string; project: ResolvedMemberPageProject } =>
        entry.project !== null,
    );

  if (resolved.length === 0) return null;

  return (
    <section aria-labelledby={`projects-${block.id}`}>
      <h2
        id={`projects-${block.id}`}
        className="text-xs font-bold tracking-[0.18em] text-muted uppercase"
      >
        Projects
      </h2>
      <div
        className={
          block.variant === "stacked"
            ? "mt-4 space-y-6"
            : "mt-4 space-y-4"
        }
      >
        {resolved.map((entry) => (
          <MemberPageV2ProjectCard
            key={entry.id}
            project={entry.project}
            assetMetadata={assetMetadata}
            variant={block.variant}
          />
        ))}
      </div>
    </section>
  );
}
