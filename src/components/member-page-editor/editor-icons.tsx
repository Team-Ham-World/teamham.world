"use client";

import type { MemberBlock } from "@/lib/members/v2/document";

/**
 * Editor chrome glyphs.
 *
 * Every icon here is decorative: each control that uses one also carries a
 * text label, an `aria-label`, or `sr-only` text, so nothing about the editor
 * depends on recognising a shape. They are drawn with `currentColor` and a
 * 2px stroke so they sit at the same weight as the HAM Paper rules around
 * them.
 */

const ICON_BASE = {
  "aria-hidden": true,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

type IconProps = { className?: string };

function Icon({
  className = "size-4",
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg {...ICON_BASE} className={className}>
      {children}
    </svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </Icon>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </Icon>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
    </Icon>
  );
}

export function DuplicateIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="11" height="11" />
      <path d="M5 15H4V4h11v1" />
    </Icon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </Icon>
  );
}

export function GripIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="6" r="1.1" fill="currentColor" />
      <circle cx="15" cy="6" r="1.1" fill="currentColor" />
      <circle cx="9" cy="12" r="1.1" fill="currentColor" />
      <circle cx="15" cy="12" r="1.1" fill="currentColor" />
      <circle cx="9" cy="18" r="1.1" fill="currentColor" />
      <circle cx="15" cy="18" r="1.1" fill="currentColor" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  );
}

export function ExtractIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="8" height="14" />
      <path d="M15 7v10M19 7v10" />
    </Icon>
  );
}

export function PersonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5" />
    </Icon>
  );
}

function RichTextIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16M4 11h16M4 16h11" />
    </Icon>
  );
}

function FeaturedProjectIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" />
      <path d="M3.5 14.5 9 10l4 3.5 3-2.5 4.5 3.5" />
      <circle cx="15.5" cy="8" r="1.3" />
    </Icon>
  );
}

function ProjectListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </Icon>
  );
}

function LinksIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 1 0-5.7-5.7L11.5 6.8" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 1 0 5.7 5.7l1.3-1.3" />
    </Icon>
  );
}

function ImageIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5" width="17" height="14" />
      <circle cx="8.5" cy="10" r="1.4" />
      <path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" />
    </Icon>
  );
}

function GalleryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" />
      <rect x="13.5" y="3.5" width="7" height="7" />
      <rect x="3.5" y="13.5" width="7" height="7" />
      <rect x="13.5" y="13.5" width="7" height="7" />
    </Icon>
  );
}

function QuoteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.5 7c-2.5 1-3.8 3-3.8 5.6V17h4.6v-4.6H7.6c0-1.7.7-2.9 2.4-3.7Z" />
      <path d="M18 7c-2.5 1-3.8 3-3.8 5.6V17h4.6v-4.6h-2.7c0-1.7.7-2.9 2.4-3.7Z" />
    </Icon>
  );
}

function EmbedIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5" width="17" height="14" />
      <path d="m9 9-3 3 3 3M15 9l3 3-3 3" />
    </Icon>
  );
}

const BLOCK_ICONS: Record<
  MemberBlock["type"],
  (props: IconProps) => React.ReactElement
> = {
  richText: RichTextIcon,
  featuredProject: FeaturedProjectIcon,
  projectList: ProjectListIcon,
  additionalLinks: LinksIcon,
  image: ImageIcon,
  gallery: GalleryIcon,
  calloutQuote: QuoteIcon,
  embed: EmbedIcon,
};

/** Decorative type glyph for a block, used beside its always-present label. */
export function BlockTypeIcon({
  type,
  className,
}: {
  type: MemberBlock["type"];
  className?: string;
}) {
  const Glyph = BLOCK_ICONS[type];
  return <Glyph className={className} />;
}
