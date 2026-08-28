import type { GalleryBlock } from "@/lib/members/v2/document";
import type { AssetMetadata } from "../MemberPageV2View";

import { MemberPageV2Image } from "./MemberPageV2Image";

interface MemberPageV2GalleryProps {
  block: GalleryBlock;
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
}

export function MemberPageV2Gallery({
  block,
  assetMetadata,
}: MemberPageV2GalleryProps) {
  // A degraded asset must not leave a caption-only shell behind: omit the item
  // entirely, and omit the whole gallery when nothing renderable remains.
  const items = block.items.filter((item) =>
    assetMetadata.has(item.image.assetId),
  );
  if (items.length === 0) return null;

  return (
    <section aria-labelledby={`gallery-${block.id}`}>
      <h2
        id={`gallery-${block.id}`}
        className="text-xs font-bold tracking-[0.18em] text-muted uppercase"
      >
        Gallery
      </h2>

      {block.variant === "grid" ? (
        <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {items.map((item) => (
            <figure key={item.id} className="card-tilt">
              <MemberPageV2Image
                imageRef={item.image}
                assetMetadata={assetMetadata}
                sizes="(min-width: 640px) 50vw, 100vw"
              />
              {item.caption ? (
                <figcaption className="mt-3 text-sm text-muted">
                  {item.caption}
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      ) : (
        <div className="mt-4 space-y-6">
          {items.map((item) => (
            <figure key={item.id} className="card-tilt max-w-3xl">
              <MemberPageV2Image
                imageRef={item.image}
                assetMetadata={assetMetadata}
                sizes="(min-width: 1024px) 768px, calc(100vw - 2.5rem)"
              />
              {item.caption ? (
                <figcaption className="mt-3 text-sm text-muted">
                  {item.caption}
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
