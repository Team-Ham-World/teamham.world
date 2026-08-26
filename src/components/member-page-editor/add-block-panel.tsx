"use client";

import { useState } from "react";

import type {
  GalleryBlock,
  ImageBlock,
  MemberBlock,
  MemberProjectRef,
  RichTextDoc,
} from "@/lib/members/v2/document";
import {
  MAX_CAPTION_CHARS,
  MAX_COLLECTION_ITEMS,
  MIN_GALLERY_ITEMS,
} from "@/lib/members/v2/limits";

import {
  EDITOR_BLOCK_KINDS,
  EDITOR_FIELD_LIMITS,
  HAM_PROJECT_CHOICES,
  buildAdditionalLinksBlock,
  buildCalloutQuoteBlock,
  buildFeaturedProjectBlock,
  buildHamProjectRef,
  buildProjectListBlock,
  buildRichTextBlock,
  isLikelyHttpsUrl,
} from "./block-catalog";
import type { EditorAsset } from "./asset-api";
import {
  buildGalleryBlockFromDraft,
  buildImageBlockFromDraft,
  buildReadyImageRef,
  imageRefToDraft,
  type GalleryItemDraft,
  type ImageUseDraft,
} from "./asset-model";
import {
  EDITOR_CONTROL,
  EDITOR_HINT,
  EDITOR_PRIMARY_CONTROL,
  EDITOR_QUIET_CONTROL,
  SelectField,
  TextAreaField,
  TextField,
} from "./editor-controls";
import { BlockTypeIcon } from "./editor-icons";
import type { MemberEditorIdGenerator } from "./ids";
import { ImageDraftFields, emptyImageUseDraft } from "./image-fields";
import { ProjectRefFields } from "./project-ref-fields";
import { RichTextEditorLazy } from "./rich-text-editor-lazy";

/**
 * Add block flow.
 *
 * Creation state lives here and never touches the draft. A block is inserted
 * only once it holds enough valid content to satisfy its own schema, so an
 * empty placeholder can never reach autosave.
 */

type DraftKind =
  | "featuredProject"
  | "projectList"
  | "additionalLinks"
  | "calloutQuote"
  | "richText"
  | "image"
  | "gallery";

type CreationDraft =
  | { kind: "featuredProject" | "projectList"; project: MemberProjectRef }
  | {
      kind: "additionalLinks";
      label: string;
      url: string;
      description: string;
    }
  | {
      kind: "calloutQuote";
      variant: "note" | "quote";
      text: string;
      attribution: string;
    }
  | { kind: "richText"; content: RichTextDoc | null }
  | {
      kind: "image";
      variant: ImageBlock["variant"];
      image: ImageUseDraft;
      caption: string;
    }
  | {
      kind: "gallery";
      variant: GalleryBlock["variant"];
      items: GalleryItemDraft[];
    };

function newGalleryItem(nextId: MemberEditorIdGenerator): GalleryItemDraft {
  return {
    draftId: nextId(),
    ...emptyImageUseDraft(),
    caption: "",
  };
}

function initialDraft(
  kind: DraftKind,
  nextId: MemberEditorIdGenerator,
): CreationDraft {
  if (kind === "featuredProject" || kind === "projectList") {
    return {
      kind,
      project: buildHamProjectRef(HAM_PROJECT_CHOICES[0]?.slug ?? ""),
    };
  }
  if (kind === "additionalLinks") {
    return { kind, label: "", url: "", description: "" };
  }
  if (kind === "calloutQuote") {
    return { kind, variant: "note", text: "", attribution: "" };
  }
  if (kind === "richText") {
    return { kind, content: null };
  }
  if (kind === "image") {
    return {
      kind,
      variant: "framed",
      image: emptyImageUseDraft(),
      caption: "",
    };
  }
  return {
    kind,
    variant: "grid",
    items: [newGalleryItem(nextId), newGalleryItem(nextId)],
  };
}

function isDraftComplete(
  draft: CreationDraft,
  assets: readonly EditorAsset[],
): boolean {
  switch (draft.kind) {
    case "featuredProject":
    case "projectList":
      return draft.project.kind === "ham"
        ? draft.project.projectSlug.trim() !== ""
        : draft.project.name.trim() !== "" &&
            draft.project.shortDescription.trim() !== "" &&
            draft.project.type.trim() !== "" &&
            (!draft.project.url || isLikelyHttpsUrl(draft.project.url)) &&
            (!draft.project.repository || isLikelyHttpsUrl(draft.project.repository)) &&
            (!draft.project.artwork ||
              buildReadyImageRef(
                imageRefToDraft(draft.project.artwork),
                assets,
              ) !== null);
    case "additionalLinks":
      return draft.label.trim() !== "" && isLikelyHttpsUrl(draft.url);
    case "calloutQuote":
      return draft.text.trim() !== "";
    case "richText":
      return draft.content !== null;
    case "image":
      return buildReadyImageRef(draft.image, assets) !== null;
    case "gallery":
      return (
        draft.items.length >= MIN_GALLERY_ITEMS &&
        draft.items.length <= MAX_COLLECTION_ITEMS &&
        draft.items.every((item) => buildReadyImageRef(item, assets) !== null)
      );
  }
}

function buildBlock(
  draft: CreationDraft,
  assets: readonly EditorAsset[],
  nextId: MemberEditorIdGenerator,
): MemberBlock | null {
  switch (draft.kind) {
    case "featuredProject":
      return buildFeaturedProjectBlock(draft.project, nextId);
    case "projectList":
      return buildProjectListBlock(draft.project, nextId);
    case "additionalLinks":
      return buildAdditionalLinksBlock(
        {
          label: draft.label.trim(),
          url: draft.url.trim(),
          description:
            draft.description.trim() === "" ? null : draft.description.trim(),
        },
        nextId,
      );
    case "calloutQuote":
      return buildCalloutQuoteBlock(
        {
          variant: draft.variant,
          text: draft.text.trim(),
          attribution:
            draft.variant === "quote" && draft.attribution.trim() !== ""
              ? draft.attribution.trim()
              : null,
        },
        nextId,
      );
    case "richText":
      return draft.content ? buildRichTextBlock(draft.content, nextId) : null;
    case "image":
      return buildImageBlockFromDraft(draft, assets, nextId);
    case "gallery":
      return buildGalleryBlockFromDraft(draft, assets, nextId);
  }
}

export function AddBlockPanel({
  canAddBlock,
  canAddFeaturedProject,
  blockCount,
  maxBlocks,
  nextId,
  assets,
  onAdd,
  presentation = "panel",
}: {
  canAddBlock: boolean;
  canAddFeaturedProject: boolean;
  blockCount: number;
  maxBlocks: number;
  nextId: MemberEditorIdGenerator;
  assets: readonly EditorAsset[];
  onAdd: (block: MemberBlock) => void;
  /** `inspector` drops the panel frame; the rail supplies title and count. */
  presentation?: "panel" | "inspector";
}) {
  const [draft, setDraft] = useState<CreationDraft | null>(null);
  const inspector = presentation === "inspector";

  return (
    <section
      id="member-page-add-block"
      tabIndex={-1}
      aria-labelledby="add-block-heading"
      className={`min-w-0 max-w-full focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-interactive-blue ${
        inspector ? "" : "border-2 border-dashed border-ink bg-surface p-5"
      }`}
    >
      <div
        className={`flex flex-wrap items-baseline justify-between gap-3 ${
          inspector ? "sr-only" : ""
        }`}
      >
        <h3
          id="add-block-heading"
          className="text-xs font-bold tracking-[0.18em] text-muted uppercase"
        >
          Add a block
        </h3>
        <p className="text-sm text-muted">
          {blockCount} of {maxBlocks} used
        </p>
      </div>

      {!canAddBlock ? (
        <p className={EDITOR_HINT}>
          This page is full at {maxBlocks} blocks. Delete one to add another.
        </p>
      ) : draft === null ? (
        <ul className={`grid gap-2 ${inspector ? "" : "mt-4 sm:grid-cols-2"}`}>
          {EDITOR_BLOCK_KINDS.map((kind) => {
            const featuredBlocked =
              kind.type === "featuredProject" && !canAddFeaturedProject;
            const unavailable = kind.availability.kind === "unavailable";
            const disabled = unavailable || featuredBlocked;
            const reason = unavailable
              ? kind.availability.kind === "unavailable"
                ? kind.availability.reason
                : ""
              : featuredBlocked
                ? "Your page already has a featured project."
                : "";

            return (
              <li key={kind.type}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-describedby={reason ? `add-${kind.type}-reason` : undefined}
                  className={`${EDITOR_QUIET_CONTROL} w-full items-start justify-start px-3 py-2 text-left`}
                  onClick={() =>
                    setDraft(initialDraft(kind.type as DraftKind, nextId))
                  }
                >
                  <BlockTypeIcon
                    type={kind.type}
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block">Add {kind.label}</span>
                    <span className="mt-0.5 block text-xs leading-snug font-normal text-muted">
                      {kind.description}
                    </span>
                  </span>
                </button>
                {reason ? (
                  <p id={`add-${kind.type}-reason`} className="mt-2 text-sm text-muted">
                    {reason}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <DraftForm
          draft={draft}
          assets={assets}
          nextId={nextId}
          setDraft={setDraft}
          onCancel={() => setDraft(null)}
          onConfirm={() => {
            if (!isDraftComplete(draft, assets)) return;
            const block = buildBlock(draft, assets, nextId);
            if (!block) return;
            onAdd(block);
            setDraft(null);
          }}
        />
      )}
    </section>
  );
}

function DraftForm({
  draft,
  assets,
  nextId,
  setDraft,
  onCancel,
  onConfirm,
}: {
  draft: CreationDraft;
  assets: readonly EditorAsset[];
  nextId: MemberEditorIdGenerator;
  setDraft: (draft: CreationDraft) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const complete = isDraftComplete(draft, assets);

  return (
    <div className="mt-5">
      <p className={EDITOR_HINT}>
        Nothing saves until you add the block.
      </p>

      <div className="mt-4 space-y-5">
        {draft.kind === "featuredProject" || draft.kind === "projectList" ? (
          <ProjectRefFields
            idPrefix="new-block-project"
            project={draft.project}
            assets={assets}
            onChange={(project) => setDraft({ ...draft, project })}
          />
        ) : null}

        {draft.kind === "additionalLinks" ? (
          <>
            <TextField
              id="new-block-link-label"
              label="Label"
              value={draft.label}
              maxLength={EDITOR_FIELD_LIMITS.linkLabel}
              onChange={(label) => setDraft({ ...draft, label })}
            />
            <TextField
              id="new-block-link-url"
              label="Address"
              type="url"
              inputMode="url"
              value={draft.url}
              maxLength={EDITOR_FIELD_LIMITS.url}
              error={
                draft.url !== "" && !isLikelyHttpsUrl(draft.url)
                  ? "Use a full https:// address."
                  : undefined
              }
              onChange={(url) => setDraft({ ...draft, url })}
            />
            <TextField
              id="new-block-link-description"
              label="Description"
              optional
              value={draft.description}
              maxLength={EDITOR_FIELD_LIMITS.linkDescription}
              onChange={(description) => setDraft({ ...draft, description })}
            />
          </>
        ) : null}

        {draft.kind === "calloutQuote" ? (
          <>
            <fieldset>
              <legend className="block text-sm font-bold text-ink">Kind</legend>
              <div className="mt-3 flex flex-wrap gap-4">
                {(["note", "quote"] as const).map((variant) => (
                  <label
                    key={variant}
                    className="inline-flex min-h-11 items-center gap-2 text-sm font-bold capitalize"
                  >
                    <input
                      type="radio"
                      name="new-block-callout-variant"
                      value={variant}
                      checked={draft.variant === variant}
                      onChange={() => setDraft({ ...draft, variant })}
                      className="size-5"
                    />
                    {variant}
                  </label>
                ))}
              </div>
            </fieldset>
            <TextAreaField
              id="new-block-callout-text"
              label={draft.variant === "quote" ? "Quote" : "Note"}
              rows={4}
              value={draft.text}
              maxLength={EDITOR_FIELD_LIMITS.callout}
              onChange={(text) => setDraft({ ...draft, text })}
            />
            {draft.variant === "quote" ? (
              <TextField
                id="new-block-callout-attribution"
                label="Attribution"
                optional
                value={draft.attribution}
                maxLength={EDITOR_FIELD_LIMITS.linkLabel}
                onChange={(attribution) => setDraft({ ...draft, attribution })}
              />
            ) : null}
          </>
        ) : null}

        {draft.kind === "richText" ? (
          <RichTextEditorLazy
            content={draft.content}
            controlId="new-block-rich-text"
            label="New rich text block"
            onCanonicalChange={(content) => setDraft({ ...draft, content })}
          />
        ) : null}

        {draft.kind === "image" ? (
          <>
            <SelectField
              id="new-block-image-variant"
              label="Layout"
              value={draft.variant}
              options={[
                { value: "framed", label: "Framed" },
                { value: "wide", label: "Wide" },
              ]}
              onChange={(variant) =>
                setDraft({
                  ...draft,
                  variant: variant as ImageBlock["variant"],
                })
              }
            />
            <ImageDraftFields
              idPrefix="new-block-image"
              draft={draft.image}
              assets={assets}
              onChange={(image) => setDraft({ ...draft, image })}
            />
            <TextField
              id="new-block-image-caption"
              label="Caption"
              optional
              value={draft.caption}
              maxLength={MAX_CAPTION_CHARS}
              onChange={(caption) => setDraft({ ...draft, caption })}
            />
          </>
        ) : null}

        {draft.kind === "gallery" ? (
          <>
            <SelectField
              id="new-block-gallery-variant"
              label="Layout"
              value={draft.variant}
              options={[
                { value: "grid", label: "Grid" },
                { value: "strip", label: "Strip" },
              ]}
              onChange={(variant) =>
                setDraft({
                  ...draft,
                  variant: variant as GalleryBlock["variant"],
                })
              }
            />
            <p className={EDITOR_HINT}>
              A gallery stays outside the document until at least {MIN_GALLERY_ITEMS}
              ready images have complete image descriptions.
            </p>
            <ul className="space-y-5">
              {draft.items.map((item, index) => (
                <li key={item.draftId} className="border-2 border-ink bg-paper p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
                      Gallery image {index + 1}
                    </p>
                    <button
                      type="button"
                      className={EDITOR_CONTROL}
                      disabled={draft.items.length <= MIN_GALLERY_ITEMS}
                      aria-label={`Remove gallery image ${index + 1}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          items: draft.items.filter(
                            (entry) => entry.draftId !== item.draftId,
                          ),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-4 space-y-5">
                    <ImageDraftFields
                      idPrefix={`new-block-gallery-${item.draftId}`}
                      draft={item}
                      assets={assets}
                      onChange={(image) =>
                        setDraft({
                          ...draft,
                          items: draft.items.map((entry) =>
                            entry.draftId === item.draftId
                              ? { ...entry, ...image }
                              : entry,
                          ),
                        })
                      }
                    />
                    <TextField
                      id={`new-block-gallery-${item.draftId}-caption`}
                      label="Caption"
                      optional
                      value={item.caption}
                      maxLength={MAX_CAPTION_CHARS}
                      onChange={(caption) =>
                        setDraft({
                          ...draft,
                          items: draft.items.map((entry) =>
                            entry.draftId === item.draftId
                              ? { ...entry, caption }
                              : entry,
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
              disabled={draft.items.length >= MAX_COLLECTION_ITEMS}
              onClick={() =>
                setDraft({
                  ...draft,
                  items: [...draft.items, newGalleryItem(nextId)],
                })
              }
            >
              Add another gallery image
            </button>
          </>
        ) : null}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          className={EDITOR_PRIMARY_CONTROL}
          disabled={!complete}
          onClick={onConfirm}
        >
          Add block
        </button>
        <button type="button" className={EDITOR_CONTROL} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {!complete ? (
        <p className={EDITOR_HINT}>
          Fill in the required details above to add this block.
        </p>
      ) : null}
    </div>
  );
}
