import type { AdditionalLinksBlock } from "@/lib/members/v2/document";

interface MemberPageV2AdditionalLinksProps {
  block: AdditionalLinksBlock;
}

export function MemberPageV2AdditionalLinks({
  block,
}: MemberPageV2AdditionalLinksProps) {
  return (
    <section aria-labelledby={`links-${block.id}`}>
      <h2
        id={`links-${block.id}`}
        className="text-xs font-bold tracking-[0.18em] text-muted uppercase"
      >
        Links
      </h2>

      {block.variant === "list" ? (
        <ul className="mt-4 space-y-4">
          {block.links.map((link) => (
            <li key={link.id}>
              <a
                href={link.url}
                rel="noopener noreferrer"
                className="inline-flex min-h-11 min-w-11 items-center font-bold text-interactive-blue underline underline-offset-4"
              >
                {link.label}
              </a>
              {link.description ? (
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {link.description}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-4">
          {block.links.map((link) => (
            <li key={link.id} className="max-w-full">
              <a
                href={link.url}
                rel="noopener noreferrer"
                aria-describedby={
                  link.description ? `link-desc-${link.id}` : undefined
                }
                className="inline-flex min-h-11 items-center gap-2 border-2 border-ink bg-surface px-5 py-3 text-sm font-bold tracking-wider text-ink uppercase shadow-[4px_4px_0_0_var(--color-ink)] transition-[transform,background-color,color] hover:-translate-y-0.5 hover:bg-ink hover:text-paper active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
              >
                {link.label}
                <span aria-hidden="true">&#8594;</span>
              </a>
              {link.description ? (
                <p
                  id={`link-desc-${link.id}`}
                  className="mt-2 max-w-xs text-sm leading-relaxed text-muted"
                >
                  {link.description}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
