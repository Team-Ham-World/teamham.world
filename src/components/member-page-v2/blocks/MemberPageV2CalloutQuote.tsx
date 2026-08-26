import type { CalloutQuoteBlock } from "@/lib/members/v2/document";

interface MemberPageV2CalloutQuoteProps {
  block: CalloutQuoteBlock;
}

export function MemberPageV2CalloutQuote({
  block,
}: MemberPageV2CalloutQuoteProps) {
  return (
    <aside
      className="card-tilt border-2 border-ink bg-surface p-5 shadow-[4px_4px_0_0_var(--color-ink)] sm:p-6"
      aria-label={block.variant === "quote" ? "Quote" : "Note"}
    >
      {block.variant === "quote" ? (
        <>
          <blockquote className="text-lg leading-relaxed text-ink italic">
            &ldquo;{block.text}&rdquo;
          </blockquote>
          {block.attribution ? (
            <p className="mt-4 text-sm font-bold text-muted">
              &mdash; {block.attribution}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-base leading-relaxed text-ink">{block.text}</p>
      )}
    </aside>
  );
}
