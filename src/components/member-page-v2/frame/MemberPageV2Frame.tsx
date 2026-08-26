import type { MemberPageFrameV2 } from "@/lib/members/v2/document";
import type { AssetMetadata } from "../MemberPageV2View";

import { MemberSocialLinks } from "@/components/social-links";
import { displayHostname } from "@/lib/site";
import { MemberPageV2Image } from "../blocks/MemberPageV2Image";

interface MemberPageV2FrameProps {
  frame: MemberPageFrameV2;
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
}

export function MemberPageV2Frame({
  frame,
  assetMetadata,
}: MemberPageV2FrameProps) {
  const hasSocialLinks = Object.keys(frame.socialLinks).length > 0;

  return (
    <div className="max-w-2xl">
      <p className="inline-flex -rotate-1 items-center border-2 border-ink bg-surface px-3 py-1 text-[0.7rem] font-bold tracking-[0.18em] text-ink uppercase shadow-[3px_3px_0_0_var(--color-ink)] sm:text-xs">
        HAM member
      </p>

      {frame.portrait ? (
        <div className="mt-7">
          <MemberPageV2Image
            imageRef={frame.portrait}
            assetMetadata={assetMetadata}
            sizes="(min-width: 640px) 256px, 192px"
            className="size-48 sm:size-64 border-2 border-ink shadow-[4px_4px_0_0_var(--color-ink)] object-cover"
          />
        </div>
      ) : null}

      <h1 className="font-display relative block w-fit text-4xl leading-[1.12] break-words sm:text-5xl mt-7">
        {frame.displayName}
        <svg
          aria-hidden="true"
          viewBox="0 0 120 8"
          preserveAspectRatio="none"
          className="absolute -bottom-2 left-0 h-2 w-full text-decorative-red"
        >
          <path
            d="M2 5 C 26 1, 42 8, 64 4 S 100 2, 118 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </h1>

      {frame.summary ? (
        <p className="mt-8 text-lg leading-relaxed text-muted">{frame.summary}</p>
      ) : null}

      {frame.websiteUrl || hasSocialLinks ? (
        <div className="mt-9 flex flex-wrap items-start gap-4">
          {frame.websiteUrl ? (
            <WebsiteCallToAction website={frame.websiteUrl} />
          ) : null}
          {hasSocialLinks ? (
            <MemberSocialLinks
              displayName={frame.displayName}
              links={frame.socialLinks}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WebsiteCallToAction({ website }: { website: string }) {
  const hostname = displayHostname(website);
  return (
    <div>
      <a
        href={website}
        rel="noopener noreferrer"
        aria-label={hostname ? `Visit site: ${hostname}` : undefined}
        className="inline-flex min-h-11 items-center gap-2 border-2 border-ink bg-ink px-6 py-3 text-sm font-bold tracking-wider text-paper uppercase shadow-[4px_4px_0_0_var(--color-muted)] transition-[transform,background-color,color] hover:-translate-y-0.5 hover:bg-surface hover:text-ink active:translate-x-0.5 active:translate-y-0.5"
      >
        Visit site <span aria-hidden="true">&#8594;</span>
      </a>
      {hostname ? (
        <p className="mt-3 text-xs font-bold tracking-[0.14em] text-muted lowercase">
          {hostname}
        </p>
      ) : null}
    </div>
  );
}
