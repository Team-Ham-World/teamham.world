import type { EmbedBlock } from "@/lib/members/v2/document";

const EMBED_SIZE_CLASSES: Record<EmbedBlock["variant"], string> = {
  compact: "h-[152px]",
  standard: "h-[352px]",
  widescreen: "aspect-video",
};

export function MemberPageV2Embed({ block }: { block: EmbedBlock }) {
  const provider = displayEmbedHostname(block.url);
  const iframe = (
    <iframe
      src={block.url}
      title={block.title}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture; web-share"
      allowFullScreen
      className={`block w-full border-0 ${EMBED_SIZE_CLASSES[block.variant]}`}
    />
  );

  if (!block.showFrame) {
    return (
      <section
        className="min-w-0"
        aria-label={block.title}
        data-embed-variant={block.variant}
        data-embed-frame="hidden"
      >
        {iframe}
      </section>
    );
  }

  return (
    <section
      className="card-tilt min-w-0 border-2 border-ink bg-surface shadow-[4px_4px_0_0_var(--color-ink)]"
      aria-label={block.title}
      data-embed-variant={block.variant}
      data-embed-frame="visible"
    >
      <div className="flex min-h-11 min-w-0 items-center justify-between gap-3 border-b-2 border-ink px-3 py-2 sm:px-4">
        <p className="min-w-0 truncate text-xs font-bold tracking-[0.14em] text-muted uppercase">
          {provider ?? "Embedded content"}
        </p>
        <a
          href={block.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center text-xs font-bold tracking-wider text-interactive-blue uppercase underline underline-offset-4"
        >
          Open <span aria-hidden="true">&#8599;</span>
        </a>
      </div>
      {iframe}
    </section>
  );
}

function displayEmbedHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return null;
  }
}
