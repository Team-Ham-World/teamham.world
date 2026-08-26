import type { MemberImageRef } from "@/lib/members/v2/document";
import type { AssetMetadata } from "../MemberPageV2View";

interface MemberPageV2ImageProps {
  imageRef: MemberImageRef;
  assetMetadata: ReadonlyMap<string, AssetMetadata>;
  sizes: string;
  caption?: string | null;
  variant?: "framed" | "wide";
  className?: string;
}

export function MemberPageV2Image({
  imageRef,
  assetMetadata,
  sizes,
  caption,
  variant,
  className,
}: MemberPageV2ImageProps) {
  const metadata = assetMetadata.get(imageRef.assetId);

  // Fail closed if metadata is absent
  if (!metadata) {
    return null;
  }

  const src = `/member-assets/${imageRef.assetId}`;
  const alt = imageRef.decorative ? "" : imageRef.alt ?? "";

  const baseImageClasses = "w-full h-auto";
  const imageClasses = className
    ? `${baseImageClasses} ${className}`
    : `${baseImageClasses} border-2 border-ink shadow-[4px_4px_0_0_var(--color-ink)]`;

  const imageElement = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={metadata.width}
      height={metadata.height}
      sizes={sizes}
      className={imageClasses}
    />
  );

  if (!variant && !caption) {
    // Used in frame portrait or standalone without wrapper
    return imageElement;
  }

  // Block-level image with optional caption
  const containerClasses =
    variant === "wide"
      ? "card-tilt w-full max-w-full"
      : "card-tilt max-w-3xl";

  return (
    <figure className={containerClasses} data-image-variant={variant}>
      {imageElement}
      {caption ? (
        <figcaption className="mt-3 text-sm text-muted">{caption}</figcaption>
      ) : null}
    </figure>
  );
}
