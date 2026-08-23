import { ProjectDisclosure } from "@/components/project-disclosure";
import { ProjectArtwork, StatusStamp } from "@/components/project-visuals";
import { hasExpandableContent, PROJECTS, type Project } from "@/data/projects";

function ProjectCard({ project }: { project: Project }) {
  const { slug, name, shortDescription, type, status, artwork } = project;
  const repository = project.links?.repository;
  const publicUrl = project.links?.publicUrl;

  return (
    <article
      id={slug}
      className="card-tilt border-2 border-ink bg-surface shadow-[6px_6px_0_0_var(--color-ink)]"
    >
      <div className="flex flex-col gap-6 p-5 md:flex-row md:gap-8 md:p-7">
        <div className="w-full shrink-0 md:w-[340px] lg:w-[400px]">
          <ProjectArtwork
            artwork={artwork}
            sizes="(min-width: 1024px) 400px, (min-width: 768px) 340px, 100vw"
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 pb-1">
            <h3 className="font-display text-2xl leading-tight md:text-3xl">
              {name}
            </h3>
            <StatusStamp status={status} />
          </div>

          <p className="mt-2 text-xs font-bold tracking-[0.18em] text-muted uppercase">
            {type}
          </p>

          <p className="mt-4 max-w-prose leading-relaxed text-muted">
            {shortDescription}
          </p>

          {/*
            Content gate: the trigger appears only when there is approved
            content behind it. An empty panel must never render.
          */}
          {hasExpandableContent(project) ? (
            <ProjectDisclosure slug={slug} label="Details">
              {project.longDescription ? (
                <p className="max-w-prose leading-relaxed text-muted">
                  {project.longDescription}
                </p>
              ) : null}

              {project.makers.length > 0 ? (
                <p className="mt-4 text-sm text-muted">
                  <span className="font-bold tracking-wide text-ink">
                    Made by
                  </span>{" "}
                  {project.makers.join(", ")}
                </p>
              ) : null}

              {repository || publicUrl ? (
                <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  {publicUrl ? (
                    <li>
                      <a
                        href={publicUrl}
                        className="font-bold text-interactive-blue underline underline-offset-4"
                      >
                        Visit
                      </a>
                    </li>
                  ) : null}
                  {repository ? (
                    <li>
                      <a
                        href={repository}
                        className="font-bold text-interactive-blue underline underline-offset-4"
                      >
                        Source
                      </a>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </ProjectDisclosure>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ProjectShelf() {
  return (
    <div className="flex flex-col gap-8">
      {PROJECTS.map((project) => (
        <ProjectCard key={project.slug} project={project} />
      ))}
    </div>
  );
}
