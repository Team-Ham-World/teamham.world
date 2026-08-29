"use client";

import { useState } from "react";

import type {
  AdditionalLinksBlock,
  CalloutQuoteBlock,
  FeaturedProjectBlock,
  GalleryBlock,
  ImageBlock,
  MemberBlock,
  MemberBlockRowRatio,
  ProjectListBlock,
} from "@/lib/members/v2/document";
import {
  MAX_CAPTION_CHARS,
  MAX_COLLECTION_ITEMS,
  MIN_GALLERY_ITEMS,
} from "@/lib/members/v2/limits";

import {
  EDITOR_FIELD_LIMITS,
  buildHamProjectRef,
  editorBlockKind,
  isLikelyHttpsUrl,
  HAM_PROJECT_CHOICES,
} from "./block-catalog";
import type { EditorAsset } from "./asset-api";
import { buildReadyImageRef, type ImageUseDraft } from "./asset-model";
import { blockTypeLabel } from "./document-ops";
import {
  EDITOR_CONTROL,
  EDITOR_PRIMARY_CONTROL,
  InspectorSection,
  SelectField,
  TextAreaField,
  TextField,
} from "./editor-controls";
import type { MemberEditorIdGenerator } from "./ids";
import {
  ImageDraftFields,
  ImageReferenceFields,
  emptyImageUseDraft,
} from "./image-fields";
import { ProjectRefFields } from "./project-ref-fields";
import {
  RichTextEditorLazy,
  type RichTextTransientDraft,
} from "./rich-text-editor-lazy";

export function BlockInspector({
  block,
  onChange,
  nextId,
  assets,
  richTextTransient,
  onRichTextTransientChange,
  rowRatio = null,
  pairingAvailability = null,
  onPair,
  onSetRatio,
  onSwapSides,
  onSplitRow,
}: {
  block: MemberBlock;
  onChange: (block: MemberBlock) => void;
  nextId: MemberEditorIdGenerator;
  assets: readonly EditorAsset[];
  richTextTransient?: RichTextTransientDraft;
  onRichTextTransientChange?: (draft: RichTextTransientDraft | null) => void;
  rowRatio?: MemberBlockRowRatio | null;
  pairingAvailability?: { previous: boolean; next: boolean } | null;
  onPair?: (side: "previous" | "next") => void;
  onSetRatio?: (ratio: MemberBlockRowRatio) => void;
  onSwapSides?: () => void;
  onSplitRow?: () => void;
}) {
  const kind = editorBlockKind(block.type);

  return (
    <div className="space-y-6">
      <InspectorSection title={blockTypeLabel(block.type)} description={kind.description}>
        {block.type === "featuredProject" ? (
          <FeaturedProjectFields block={block} assets={assets} onChange={onChange} />
        ) : null}
        {block.type === "projectList" ? (
          <ProjectListFields
            block={block}
            assets={assets}
            onChange={onChange}
            nextId={nextId}
          />
        ) : null}
        {block.type === "additionalLinks" ? (
          <AdditionalLinksFields block={block} onChange={onChange} nextId={nextId} />
        ) : null}
        {block.type === "calloutQuote" ? (
          <CalloutQuoteFields block={block} onChange={onChange} />
        ) : null}
        {block.type === "image" ? (
          <ImageBlockFields block={block} assets={assets} onChange={onChange} />
        ) : null}
        {block.type === "gallery" ? (
          <GalleryBlockFields
            block={block}
            assets={assets}
            nextId={nextId}
            onChange={onChange}
          />
        ) : null}
        {block.type === "richText" ? (
          <RichTextEditorLazy
            content={block.content}
            controlId={`block-${block.id}-rich-text`}
            label="Rich text block content"
            transientDraft={richTextTransient}
            onTransientChange={onRichTextTransientChange}
            onCanonicalChange={(content) => {
              if (content) onChange({ ...block, content });
            }}
          />
        ) : null}
      </InspectorSection>

      {rowRatio ? (
        <InspectorSection
          title="Row layout"
          description="This block shares a row with a partner. Width changes apply to the whole row."
        >
          <SelectField
            id={`block-${block.id}-row-ratio`}
            label="Column widths"
            value={rowRatio}
            options={[
              { value: "1:1", label: "Equal width" },
              { value: "1:2", label: "Right wider" },
              { value: "2:1", label: "Left wider" },
            ]}
            onChange={(value) => {
              if (
                value === "1:1" ||
                value === "1:2" ||
                value === "2:1"
              ) {
                onSetRatio?.(value);
              }
            }}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={EDITOR_CONTROL}
              onClick={() => onSwapSides?.()}
            >
              Swap sides
            </button>
            <button
              type="button"
              className={EDITOR_CONTROL}
              onClick={() => onSplitRow?.()}
            >
              Split row
            </button>
          </div>
        </InspectorSection>
      ) : null}

      {pairingAvailability &&
      (pairingAvailability.previous || pairingAvailability.next) ? (
        <InspectorSection
          title="Pair into a row"
          description="Place this block beside a neighbouring block in a two-column row."
        >
          <div className="flex flex-wrap gap-2">
            {pairingAvailability.previous ? (
              <button
                type="button"
                className={EDITOR_CONTROL}
                onClick={() => onPair?.("previous")}
              >
                Pair with previous
              </button>
            ) : null}
            {pairingAvailability.next ? (
              <button
                type="button"
                className={EDITOR_CONTROL}
                onClick={() => onPair?.("next")}
              >
                Pair with next
              </button>
            ) : null}
          </div>
        </InspectorSection>
      ) : null}
    </div>
  );
}

function ImageBlockFields({
  block,
  assets,
  onChange,
}: {
  block: ImageBlock;
  assets: readonly EditorAsset[];
  onChange: (block: MemberBlock) => void;
}) {
  return (
    <>
      <VariantField
        id={`block-${block.id}-variant`}
        value={block.variant}
        options={[
          { value: "framed", label: "Framed" },
          { value: "wide", label: "Wide" },
        ]}
        onChange={(variant) =>
          onChange({ ...block, variant: variant as ImageBlock["variant"] })
        }
      />
      <ImageReferenceFields
        idPrefix={`block-${block.id}-image`}
        image={block.image}
        assets={assets}
        onChange={(image) => onChange({ ...block, image })}
      />
      <TextField
        id={`block-${block.id}-caption`}
        label="Caption"
        optional
        value={block.caption ?? ""}
        maxLength={MAX_CAPTION_CHARS}
        onChange={(caption) =>
          onChange({ ...block, caption: caption === "" ? null : caption })
        }
      />
    </>
  );
}

function GalleryBlockFields({
  block,
  assets,
  nextId,
  onChange,
}: {
  block: GalleryBlock;
  assets: readonly EditorAsset[];
  nextId: MemberEditorIdGenerator;
  onChange: (block: MemberBlock) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newImage, setNewImage] = useState<ImageUseDraft>(() =>
    emptyImageUseDraft(),
  );
  const [newCaption, setNewCaption] = useState("");
  const newImageRef = buildReadyImageRef(newImage, assets);

  function resetAddFlow(): void {
    setAdding(false);
    setNewImage(emptyImageUseDraft());
    setNewCaption("");
  }

  return (
    <>
      <VariantField
        id={`block-${block.id}-variant`}
        value={block.variant}
        options={[
          { value: "grid", label: "Grid" },
          { value: "strip", label: "Strip" },
        ]}
        onChange={(variant) =>
          onChange({ ...block, variant: variant as GalleryBlock["variant"] })
        }
      />

      <ul className="space-y-6">
        {block.items.map((item, index) => (
          <li key={item.id} className="border-2 border-ink bg-paper p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
                Gallery image {index + 1}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={EDITOR_CONTROL}
                  disabled={index === 0}
                  aria-label={`Move gallery image ${index + 1} up`}
                  onClick={() =>
                    onChange({ ...block, items: moveGalleryItem(block.items, index, -1) })
                  }
                >
                  <span aria-hidden="true">&#8593;</span> Up
                </button>
                <button
                  type="button"
                  className={EDITOR_CONTROL}
                  disabled={index === block.items.length - 1}
                  aria-label={`Move gallery image ${index + 1} down`}
                  onClick={() =>
                    onChange({ ...block, items: moveGalleryItem(block.items, index, 1) })
                  }
                >
                  <span aria-hidden="true">&#8595;</span> Down
                </button>
                <button
                  type="button"
                  className={EDITOR_CONTROL}
                  disabled={block.items.length <= MIN_GALLERY_ITEMS}
                  aria-label={`Remove gallery image ${index + 1}`}
                  onClick={() =>
                    onChange({
                      ...block,
                      items: block.items.filter((entry) => entry.id !== item.id),
                    })
                  }
                >
                  Remove
                </button>
              </div>
            </div>
            <div className="mt-4 space-y-5">
              <ImageReferenceFields
                idPrefix={`block-${block.id}-item-${item.id}`}
                image={item.image}
                assets={assets}
                onChange={(image) =>
                  onChange({
                    ...block,
                    items: block.items.map((entry) =>
                      entry.id === item.id ? { ...entry, image } : entry,
                    ),
                  })
                }
              />
              <TextField
                id={`block-${block.id}-item-${item.id}-caption`}
                label="Caption"
                optional
                value={item.caption ?? ""}
                maxLength={MAX_CAPTION_CHARS}
                onChange={(caption) =>
                  onChange({
                    ...block,
                    items: block.items.map((entry) =>
                      entry.id === item.id
                        ? { ...entry, caption: caption === "" ? null : caption }
                        : entry,
                    ),
                  })
                }
              />
            </div>
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="border-2 border-dashed border-ink bg-paper p-4">
          <p className="text-sm font-bold text-ink">Add gallery image</p>
          <div className="mt-4 space-y-5">
            <ImageDraftFields
              idPrefix={`block-${block.id}-new-gallery-image`}
              draft={newImage}
              assets={assets}
              onChange={setNewImage}
            />
            <TextField
              id={`block-${block.id}-new-gallery-caption`}
              label="Caption"
              optional
              value={newCaption}
              maxLength={MAX_CAPTION_CHARS}
              onChange={setNewCaption}
            />
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className={EDITOR_PRIMARY_CONTROL}
              disabled={!newImageRef}
              onClick={() => {
                if (!newImageRef) return;
                const caption = newCaption.trim();
                onChange({
                  ...block,
                  items: [
                    ...block.items,
                    {
                      id: nextId(),
                      image: newImageRef,
                      caption: caption === "" ? null : caption,
                    },
                  ],
                });
                resetAddFlow();
              }}
            >
              Add to gallery
            </button>
            <button type="button" className={EDITOR_CONTROL} onClick={resetAddFlow}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={EDITOR_CONTROL}
          disabled={block.items.length >= MAX_COLLECTION_ITEMS}
          onClick={() => setAdding(true)}
        >
          Add gallery image
        </button>
      )}
    </>
  );
}

function moveGalleryItem(
  items: GalleryBlock["items"],
  index: number,
  offset: -1 | 1,
): GalleryBlock["items"] {
  const target = index + offset;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function VariantField({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <SelectField
      id={id}
      label="Layout"
      value={value}
      options={options}
      onChange={onChange}
    />
  );
}

function FeaturedProjectFields({
  block,
  assets,
  onChange,
}: {
  block: FeaturedProjectBlock;
  assets: readonly EditorAsset[];
  onChange: (block: MemberBlock) => void;
}) {
  return (
    <>
      <VariantField
        id={`block-${block.id}-variant`}
        value={block.variant}
        options={[
          { value: "card", label: "Card" },
          { value: "artwork-first", label: "Artwork first" },
        ]}
        onChange={(variant) =>
          onChange({ ...block, variant: variant as FeaturedProjectBlock["variant"] })
        }
      />
      <ProjectRefFields
        idPrefix={`block-${block.id}-project`}
        project={block.project}
        assets={assets}
        onChange={(project) => onChange({ ...block, project })}
      />
    </>
  );
}

function ProjectListFields({
  block,
  assets,
  onChange,
  nextId,
}: {
  block: ProjectListBlock;
  assets: readonly EditorAsset[];
  onChange: (block: MemberBlock) => void;
  nextId: MemberEditorIdGenerator;
}) {
  const canAdd = block.projects.length < EDITOR_FIELD_LIMITS.collectionItems;

  return (
    <>
      <VariantField
        id={`block-${block.id}-variant`}
        value={block.variant}
        options={[
          { value: "stacked", label: "Stacked" },
          { value: "compact", label: "Compact" },
        ]}
        onChange={(variant) =>
          onChange({ ...block, variant: variant as ProjectListBlock["variant"] })
        }
      />

      <ul className="space-y-6">
        {block.projects.map((entry, index) => (
          <li key={entry.id} className="border-2 border-ink bg-paper p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
                Project {index + 1}
              </p>
              <button
                type="button"
                className={EDITOR_CONTROL}
                disabled={block.projects.length <= 1}
                aria-label={`Remove project ${index + 1} from project list`}
                onClick={() =>
                  onChange({
                    ...block,
                    projects: block.projects.filter((item) => item.id !== entry.id),
                  })
                }
              >
                Remove
              </button>
            </div>
            <div className="mt-4">
              <ProjectRefFields
                idPrefix={`block-${block.id}-entry-${entry.id}`}
                project={entry.project}
                assets={assets}
                onChange={(project) =>
                  onChange({
                    ...block,
                    projects: block.projects.map((item) =>
                      item.id === entry.id ? { ...item, project } : item,
                    ),
                  })
                }
              />
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={EDITOR_CONTROL}
        disabled={!canAdd}
        aria-label="Add another project to project list"
        onClick={() =>
          onChange({
            ...block,
            projects: [
              ...block.projects,
              {
                id: nextId(),
                project: buildHamProjectRef(HAM_PROJECT_CHOICES[0]?.slug ?? ""),
              },
            ],
          })
        }
      >
        Add project
      </button>
    </>
  );
}

function AdditionalLinksFields({
  block,
  onChange,
  nextId,
}: {
  block: AdditionalLinksBlock;
  onChange: (block: MemberBlock) => void;
  nextId: MemberEditorIdGenerator;
}) {
  const canAdd = block.links.length < EDITOR_FIELD_LIMITS.collectionItems;

  return (
    <>
      <VariantField
        id={`block-${block.id}-variant`}
        value={block.variant}
        options={[
          { value: "list", label: "List" },
          { value: "buttons", label: "Buttons" },
        ]}
        onChange={(variant) =>
          onChange({ ...block, variant: variant as AdditionalLinksBlock["variant"] })
        }
      />

      <ul className="space-y-6">
        {block.links.map((link, index) => (
          <li key={link.id} className="border-2 border-ink bg-paper p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
                Link {index + 1}
              </p>
              <button
                type="button"
                className={EDITOR_CONTROL}
                disabled={block.links.length <= 1}
                aria-label={`Remove link ${index + 1} from additional links`}
                onClick={() =>
                  onChange({
                    ...block,
                    links: block.links.filter((item) => item.id !== link.id),
                  })
                }
              >
                Remove
              </button>
            </div>
            <div className="mt-4 space-y-5">
              <TextField
                id={`block-${block.id}-link-${link.id}-label`}
                label="Label"
                value={link.label}
                maxLength={EDITOR_FIELD_LIMITS.linkLabel}
                error={link.label.trim() === "" ? "Add a label." : undefined}
                onChange={(label) => updateLink(block, link.id, { label }, onChange)}
              />
              <TextField
                id={`block-${block.id}-link-${link.id}-url`}
                label="Address"
                type="url"
                inputMode="url"
                value={link.url}
                maxLength={EDITOR_FIELD_LIMITS.url}
                error={
                  isLikelyHttpsUrl(link.url) ? undefined : "Use a full https:// address."
                }
                onChange={(url) => updateLink(block, link.id, { url }, onChange)}
              />
              <TextField
                id={`block-${block.id}-link-${link.id}-description`}
                label="Description"
                optional
                value={link.description ?? ""}
                maxLength={EDITOR_FIELD_LIMITS.linkDescription}
                onChange={(description) =>
                  updateLink(
                    block,
                    link.id,
                    { description: description === "" ? null : description },
                    onChange,
                  )
                }
              />
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={EDITOR_CONTROL}
        disabled={!canAdd}
        aria-label="Add another link to additional links"
        onClick={() =>
          onChange({
            ...block,
            links: [
              ...block.links,
              { id: nextId(), label: "", url: "", description: null },
            ],
          })
        }
      >
        Add link
      </button>
    </>
  );
}

function CalloutQuoteFields({
  block,
  onChange,
}: {
  block: CalloutQuoteBlock;
  onChange: (block: MemberBlock) => void;
}) {
  return (
    <>
      <VariantField
        id={`block-${block.id}-variant`}
        value={block.variant}
        options={[
          { value: "note", label: "Note" },
          { value: "quote", label: "Quote" },
        ]}
        onChange={(value) => {
          const variant = value as CalloutQuoteBlock["variant"];
          onChange({
            ...block,
            variant,
            // A note carries no attribution, so switching clears it.
            attribution: variant === "quote" ? block.attribution : null,
          });
        }}
      />
      <TextAreaField
        id={`block-${block.id}-text`}
        label={block.variant === "quote" ? "Quote" : "Note"}
        rows={4}
        value={block.text}
        maxLength={EDITOR_FIELD_LIMITS.callout}
        error={block.text.trim() === "" ? "Add the text to show." : undefined}
        onChange={(text) => onChange({ ...block, text })}
      />
      {block.variant === "quote" ? (
        <TextField
          id={`block-${block.id}-attribution`}
          label="Attribution"
          optional
          value={block.attribution ?? ""}
          maxLength={EDITOR_FIELD_LIMITS.linkLabel}
          onChange={(value) =>
            onChange({ ...block, attribution: value === "" ? null : value })
          }
        />
      ) : null}
    </>
  );
}

function updateLink(
  block: AdditionalLinksBlock,
  linkId: string,
  patch: Partial<AdditionalLinksBlock["links"][number]>,
  onChange: (block: MemberBlock) => void,
): void {
  onChange({
    ...block,
    links: block.links.map((item) =>
      item.id === linkId ? { ...item, ...patch } : item,
    ),
  });
}
