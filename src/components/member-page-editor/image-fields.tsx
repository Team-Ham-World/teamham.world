"use client";

import { useState } from "react";

import type { MemberImageRef } from "@/lib/members/v2/document";
import { MAX_IMAGE_ALT_CHARS } from "@/lib/members/v2/limits";

import type { EditorAsset, ReadyEditorAsset } from "./asset-api";
import {
  buildReadyImageRef,
  imageRefToDraft,
  readyEditorAssets,
  type ImageUseDraft,
} from "./asset-model";
import {
  EDITOR_HINT,
  EDITOR_INPUT,
  EDITOR_LABEL,
  FieldError,
  TextAreaField,
} from "./editor-controls";

export function emptyImageUseDraft(): ImageUseDraft {
  return { assetId: "", alt: "", decorative: false };
}

export function ImageReferenceFields({
  idPrefix,
  image,
  assets,
  onChange,
}: {
  idPrefix: string;
  image: MemberImageRef;
  assets: readonly EditorAsset[];
  onChange: (image: MemberImageRef) => void;
}) {
  const controlledDraft = imageRefToDraft(image);
  const [transient, setTransient] = useState<{
    source: ImageUseDraft;
    draft: ImageUseDraft;
  } | null>(null);
  const draft =
    transient && imageUseDraftsEqual(transient.source, controlledDraft)
      ? transient.draft
      : controlledDraft;

  return (
    <ImageDraftFields
      idPrefix={idPrefix}
      draft={draft}
      assets={assets}
      onChange={(next) => {
        const committed = buildReadyImageRef(next, assets);
        if (committed) {
          setTransient(null);
          onChange(committed);
          return;
        }
        setTransient({ source: controlledDraft, draft: next });
      }}
    />
  );
}

function imageUseDraftsEqual(
  left: ImageUseDraft,
  right: ImageUseDraft,
): boolean {
  return (
    left.assetId === right.assetId &&
    left.alt === right.alt &&
    left.decorative === right.decorative
  );
}

/**
 * Transient image-use fields. The caller decides when to commit; pending
 * assets and incomplete alternative text can never escape through this API.
 */
export function ImageDraftFields({
  idPrefix,
  draft,
  assets,
  onChange,
}: {
  idPrefix: string;
  draft: ImageUseDraft;
  assets: readonly EditorAsset[];
  onChange: (draft: ImageUseDraft) => void;
}) {
  const ready = readyEditorAssets(assets);
  const selected = ready.find((asset) => asset.assetId === draft.assetId) ?? null;
  const currentUnavailable =
    draft.assetId !== "" && !ready.some((asset) => asset.assetId === draft.assetId);
  const altError =
    !draft.decorative && draft.alt.trim() === ""
      ? "Describe the useful information in this image, or mark it decorative."
      : undefined;

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor={`${idPrefix}-asset`} className={EDITOR_LABEL}>
          Stored image
        </label>
        <select
          id={`${idPrefix}-asset`}
          value={draft.assetId}
          disabled={ready.length === 0 && !currentUnavailable}
          onChange={(event) => onChange({ ...draft, assetId: event.target.value })}
          aria-describedby={`${idPrefix}-asset-hint`}
          className={EDITOR_INPUT}
        >
          <option value="">
            {ready.length === 0 ? "No ready images" : "Choose a ready image"}
          </option>
          {currentUnavailable ? (
            <option value={draft.assetId} disabled>
              Current image is unavailable
            </option>
          ) : null}
          {ready.map((asset, index) => (
            <option key={asset.assetId} value={asset.assetId}>
              {assetOptionLabel(asset, index)}
            </option>
          ))}
        </select>
        <p id={`${idPrefix}-asset-hint`} className={EDITOR_HINT}>
          Only verified, ready images can be placed on the page. Uploads still
          being prepared do not appear here.
        </p>
      </div>

      {selected ? <SelectedAssetPreview asset={selected} /> : null}

      <fieldset>
        <legend className={EDITOR_LABEL}>How should this image be read?</legend>
        <div className="mt-3 grid gap-3">
          <label className="flex min-h-11 items-center gap-3 border-2 border-ink bg-paper px-3 py-2 text-sm font-bold">
            <input
              type="radio"
              name={`${idPrefix}-purpose`}
              checked={!draft.decorative}
              onChange={() => onChange({ ...draft, decorative: false })}
              className="size-5 shrink-0"
            />
            Informative — it adds meaning
          </label>
          <label className="flex min-h-11 items-center gap-3 border-2 border-ink bg-paper px-3 py-2 text-sm font-bold">
            <input
              type="radio"
              name={`${idPrefix}-purpose`}
              checked={draft.decorative}
              onChange={() => onChange({ ...draft, decorative: true, alt: "" })}
              className="size-5 shrink-0"
            />
            Decorative — it adds no information
          </label>
        </div>
        <p className={EDITOR_HINT}>
          Decorative images are ignored by assistive technology. A caption does
          not replace alternative text for an informative image.
        </p>
      </fieldset>

      {!draft.decorative ? (
        <TextAreaField
          id={`${idPrefix}-alt`}
          label="Alternative text"
          rows={3}
          value={draft.alt}
          maxLength={MAX_IMAGE_ALT_CHARS}
          hint="Describe what matters in the image, not every visible detail."
          error={altError}
          onChange={(alt) => onChange({ ...draft, alt })}
        />
      ) : null}

      <FieldError
        id={`${idPrefix}-asset-error`}
        message={
          draft.assetId === ""
            ? "Choose a ready image before continuing."
            : currentUnavailable
              ? "Refresh the asset library and choose a ready image."
              : undefined
        }
      />
    </div>
  );
}

function SelectedAssetPreview({ asset }: { asset: ReadyEditorAsset }) {
  return (
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-4 border-2 border-ink bg-paper p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/member-assets/${asset.assetId}`}
        alt=""
        width={asset.width}
        height={asset.height}
        className="size-20 border-2 border-ink object-cover"
      />
      <div className="min-w-0">
        <p className="text-sm font-bold text-ink">Ready image</p>
        <p className="mt-1 text-sm text-muted">
          {asset.width} × {asset.height} · {formatMimeType(asset.mimeType)}
        </p>
      </div>
    </div>
  );
}

function assetOptionLabel(asset: ReadyEditorAsset, index: number): string {
  return `Image ${index + 1} — ${asset.width} × ${asset.height} ${formatMimeType(asset.mimeType)}`;
}

export function formatMimeType(mimeType: ReadyEditorAsset["mimeType"]): string {
  switch (mimeType) {
    case "image/jpeg":
      return "JPEG";
    case "image/png":
      return "PNG";
    case "image/webp":
      return "WebP";
    case "image/avif":
      return "AVIF";
  }
}
