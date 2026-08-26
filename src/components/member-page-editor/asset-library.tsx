"use client";

import { useState, type Dispatch, type SetStateAction } from "react";

import { MAX_READY_ASSETS } from "@/lib/members/v2/limits";

import {
  MemberAssetApiError,
  allocateMemberPageAsset,
  deleteMemberPageAsset,
  finalizeMemberPageAsset,
  listMemberPageAssets,
  putMemberPageAsset,
  type EditorAsset,
  type MemberAssetAllocation,
} from "./asset-api";
import {
  canUploadReadyAsset,
  finalizedAssetToEditorAsset,
  readyAssetCount,
  upsertEditorAsset,
} from "./asset-model";
import {
  EDITOR_HINT,
  EDITOR_INPUT,
  EDITOR_QUIET_CONTROL,
} from "./editor-controls";
import {
  MemberImageNormalizationError,
  normalizeMemberImage,
  type NormalizedMemberImage,
} from "./image-normalization";
import { formatMimeType } from "./image-fields";

interface UploadRecovery {
  source: Blob;
  fileName: string;
  normalized?: NormalizedMemberImage;
  allocation?: MemberAssetAllocation;
  resumeAt: "normalize" | "allocate" | "put" | "finalize";
}

export function AssetLibrary({
  slug,
  assets,
  referencedAssetIds,
  onAssetsChange,
  confirmDelete = defaultConfirmDelete,
  layout = "inline",
}: {
  slug: string;
  assets: readonly EditorAsset[];
  referencedAssetIds: ReadonlySet<string>;
  onAssetsChange: Dispatch<SetStateAction<EditorAsset[]>>;
  confirmDelete?: (message: string) => boolean;
  /** `rail` drops the panel frame and stacks for the narrow tool rail. */
  layout?: "inline" | "rail";
}) {
  const rail = layout === "rail";
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyAssetId, setBusyAssetId] = useState<string | null>(null);
  const [message, setMessage] = useState(() => assetLibraryMessage(assets));
  const [error, setError] = useState<string | null>(null);
  const [failedUpload, setFailedUpload] = useState<UploadRecovery | null>(null);
  const readyCount = readyAssetCount(assets);
  const pendingCount = assets.length - readyCount;
  const atQuota = !canUploadReadyAsset(assets);

  async function refresh(): Promise<void> {
    setRefreshing(true);
    setError(null);
    try {
      const latest = await listMemberPageAssets(slug);
      onAssetsChange(latest);
      setMessage(
        latest.length === 0
          ? "The asset library is empty."
          : `Asset library refreshed. ${readyAssetCount(latest)} ready, ${latest.length - readyAssetCount(latest)} pending.`,
      );
    } catch (refreshError) {
      setError(errorMessage(refreshError));
      setMessage("Asset library refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }

  async function runUpload(recovery: UploadRecovery): Promise<void> {
    if (atQuota) {
      setError(
        `This page already has ${MAX_READY_ASSETS} ready images. Delete an unused image before uploading another.`,
      );
      setMessage("Upload blocked by the ready-image quota.");
      return;
    }

    setUploading(true);
    setError(null);
    setFailedUpload(null);
    let current = recovery;
    try {
      let normalized = current.normalized;
      if (!normalized || current.resumeAt === "normalize") {
        setMessage(`Preparing ${current.fileName} in the browser…`);
        normalized = await normalizeMemberImage(current.source);
        current = { ...current, normalized, allocation: undefined, resumeAt: "allocate" };
      }

      let allocation = current.allocation;
      if (
        !allocation ||
        current.resumeAt === "allocate" ||
        Date.parse(allocation.expiresAt) <= Date.now()
      ) {
        setMessage(`Reserving storage for ${current.fileName}…`);
        allocation = await allocateMemberPageAsset({
          slug,
          mimeType: normalized.mimeType,
          byteSize: normalized.blob.size,
        });
        const pending: EditorAsset = {
          assetId: allocation.assetId,
          status: "pending",
          mimeType: null,
          width: null,
          height: null,
          createdAt: new Date().toISOString(),
          readyAt: null,
          verifiedAt: null,
          pendingExpiresAt: allocation.expiresAt,
        };
        onAssetsChange((currentAssets) =>
          upsertEditorAsset(currentAssets, pending),
        );
        current = { ...current, allocation, resumeAt: "put" };
      }

      if (current.resumeAt === "put") {
        setMessage(`Uploading the prepared copy of ${current.fileName}…`);
        await putMemberPageAsset(allocation, normalized.blob);
        current = { ...current, allocation, resumeAt: "finalize" };
      }

      setMessage(`Checking ${current.fileName} before it becomes ready…`);
      const finalized = await finalizeMemberPageAsset(slug, allocation.assetId);
      onAssetsChange((currentAssets) => {
        const previous = currentAssets.find(
          (asset) => asset.assetId === finalized.assetId,
        );
        return upsertEditorAsset(
          currentAssets,
          finalizedAssetToEditorAsset(finalized, previous),
        );
      });
      setMessage(
        `${current.fileName} is ready at ${finalized.width} × ${finalized.height}.`,
      );
    } catch (uploadError) {
      const restartAllocation =
        uploadError instanceof MemberAssetApiError &&
        (uploadError.code === "invalid_asset" || uploadError.code === "not_found");
      const retry = restartAllocation
        ? { ...current, allocation: undefined, resumeAt: "allocate" as const }
        : current;
      setFailedUpload(retry);
      setError(errorMessage(uploadError));
      setMessage(`${current.fileName} is not ready yet.`);
      if (restartAllocation) void refresh();
    } finally {
      setUploading(false);
    }
  }

  async function retryPending(assetId: string): Promise<void> {
    setBusyAssetId(assetId);
    setError(null);
    setMessage("Checking the pending upload again…");
    try {
      const finalized = await finalizeMemberPageAsset(slug, assetId);
      onAssetsChange((currentAssets) => {
        const previous = currentAssets.find(
          (asset) => asset.assetId === finalized.assetId,
        );
        return upsertEditorAsset(
          currentAssets,
          finalizedAssetToEditorAsset(finalized, previous),
        );
      });
      setMessage(
        `The image is ready at ${finalized.width} × ${finalized.height}.`,
      );
    } catch (pendingError) {
      setError(errorMessage(pendingError));
      setMessage("The pending upload could not become ready.");
      if (
        pendingError instanceof MemberAssetApiError &&
        (pendingError.code === "invalid_asset" || pendingError.code === "not_found")
      ) {
        void refresh();
      }
    } finally {
      setBusyAssetId(null);
    }
  }

  async function removeAsset(asset: EditorAsset): Promise<void> {
    const warning = referencedAssetIds.has(asset.assetId)
      ? "This image appears in the current draft. The server checks both the saved draft and live page, and refuses deletion while either one still references it. Check anyway?"
      : "Delete this stored image? The server will still refuse if the saved draft or live page references it.";
    if (!confirmDelete(warning)) return;

    setBusyAssetId(asset.assetId);
    setError(null);
    setMessage("Checking whether the image is safe to delete…");
    try {
      await deleteMemberPageAsset(slug, asset.assetId);
      onAssetsChange((currentAssets) =>
        currentAssets.filter((entry) => entry.assetId !== asset.assetId),
      );
      setMessage("Stored image deleted. The page document was not changed.");
    } catch (deleteError) {
      setError(errorMessage(deleteError));
      setMessage("The stored image was not deleted.");
    } finally {
      setBusyAssetId(null);
    }
  }

  return (
    <section
      aria-labelledby="asset-library-heading"
      data-asset-library-layout={rail ? "rail" : "inline"}
      className={
        rail
          ? "min-w-0 p-3"
          : "mt-8 border-2 border-ink bg-surface p-5 shadow-[4px_4px_0_0_var(--color-ink)]"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
            Page images
          </p>
          <h3
            id="asset-library-heading"
            className={rail ? "sr-only" : "font-display mt-1 text-2xl"}
          >
            Asset library
          </h3>
        </div>
        <div className="shrink-0 border border-ink/45 bg-paper px-2 py-1 text-xs font-bold">
          {readyCount} / {MAX_READY_ASSETS} ready
          {pendingCount > 0 ? ` \u00b7 ${pendingCount} pending` : ""}
        </div>
      </div>

      <p className={`${EDITOR_HINT} ${rail ? "text-xs" : "max-w-prose"}`}>
        Images are prepared in this browser, stripped of source metadata, and
        verified before they can appear on your page.
      </p>

      <div
        className={
          rail
            ? "mt-4 grid gap-3"
            : "mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"
        }
      >
        <div>
          <label htmlFor="asset-library-upload" className="text-sm font-bold text-ink">
            Upload an image
          </label>
          <input
            id="asset-library-upload"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            disabled={uploading || refreshing || atQuota}
            className={`${EDITOR_INPUT} text-sm file:mr-3 file:min-h-11 file:border-0 file:border-r-2 file:border-ink file:bg-ink file:px-4 file:font-bold file:text-paper disabled:cursor-not-allowed disabled:text-muted`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void runUpload({
                source: file,
                fileName: file.name || "Selected image",
                resumeAt: "normalize",
              });
            }}
          />
          <p className={`${EDITOR_HINT} ${rail ? "text-xs" : ""}`}>
            JPEG, PNG, WebP, or AVIF. The prepared file must be 5 MB or less;
            large dimensions are reduced to at most 4000 pixels per side.
          </p>
        </div>
        <button
          type="button"
          className={`${EDITOR_QUIET_CONTROL} ${rail ? "w-full" : ""}`}
          disabled={refreshing || uploading}
          onClick={() => void refresh()}
        >
          {refreshing ? "Refreshing\u2026" : "Refresh library"}
        </button>
      </div>

      {failedUpload ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-2 border-decorative-red bg-paper p-3">
          <p className="text-sm font-bold text-ink">
            {failedUpload.fileName} did not finish.
          </p>
          <button
            type="button"
            className={EDITOR_QUIET_CONTROL}
            disabled={uploading}
            onClick={() => void runUpload(failedUpload)}
          >
            Retry upload
          </button>
        </div>
      ) : null}

      <p aria-live="polite" role="status" className="mt-4 text-sm font-bold text-ink">
        {message}
      </p>
      {error ? (
        <p role="alert" className="mt-2 flex items-start gap-2 border-l-4 border-decorative-red pl-2 text-sm font-bold text-ink">
          <span aria-hidden="true" className="text-decorative-red">&#9888;</span>
          <span>{error}</span>
        </p>
      ) : null}

      {assets.length === 0 ? (
        <p className="mt-4 border-2 border-dashed border-muted bg-paper p-4 text-sm leading-relaxed text-muted">
          No stored images yet. Upload one here, then choose it for a portrait,
          project artwork, image block, or gallery.
        </p>
      ) : (
        <ul
          className={`mt-4 grid gap-3 ${
            rail ? "grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3"
          }`}
        >
          {assets.map((asset) => (
            <li
              key={asset.assetId}
              className="min-w-0 border border-ink/45 bg-paper p-2"
            >
              {asset.status === "ready" ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/member-assets/${asset.assetId}`}
                    alt=""
                    width={asset.width}
                    height={asset.height}
                    className="aspect-[4/3] w-full border border-ink/45 bg-surface object-cover"
                  />
                  <p
                    className={`mt-2 font-bold tracking-[0.14em] text-ink uppercase ${
                      rail ? "text-[0.6rem]" : "text-[0.65rem]"
                    }`}
                  >
                    Ready &#183; verified
                  </p>
                  <p className="mt-1 truncate text-xs text-muted">
                    {asset.width} &#215; {asset.height} &#183; {formatMimeType(asset.mimeType)}
                  </p>
                  {asset.verifiedAt && !rail ? (
                    <p className="mt-1 text-xs text-muted">
                      Verified {formatTimestamp(asset.verifiedAt)}
                    </p>
                  ) : null}
                </>
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center border border-dashed border-muted bg-surface p-2 text-center">
                  <div>
                    <p className="text-[0.65rem] font-bold tracking-[0.14em] text-ink uppercase">
                      Pending
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted">
                      Not selectable until verification finishes.
                    </p>
                  </div>
                </div>
              )}

              {referencedAssetIds.has(asset.assetId) ? (
                <p className="mt-2 text-xs font-bold text-ink">Used in this draft</p>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-2">
                {asset.status === "pending" ? (
                  <button
                    type="button"
                    className={`${EDITOR_QUIET_CONTROL} w-full text-xs`}
                    disabled={busyAssetId !== null}
                    onClick={() => void retryPending(asset.assetId)}
                  >
                    {busyAssetId === asset.assetId ? "Checking\u2026" : "Retry check"}
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Delete stored image"
                  className={`${EDITOR_QUIET_CONTROL} w-full text-xs`}
                  disabled={busyAssetId !== null}
                  onClick={() => void removeAsset(asset)}
                >
                  {busyAssetId === asset.assetId
                    ? "Working\u2026"
                    : rail
                      ? "Delete"
                      : "Delete stored image"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function errorMessage(error: unknown): string {
  if (
    error instanceof MemberAssetApiError ||
    error instanceof MemberImageNormalizationError
  ) {
    return error.message;
  }
  return "The image operation did not finish. Your page is unchanged; try again.";
}

function assetLibraryMessage(assets: readonly EditorAsset[]): string {
  if (assets.length === 0) return "The asset library is empty.";
  const ready = readyAssetCount(assets);
  return `Asset library loaded. ${ready} ready, ${assets.length - ready} pending.`;
}

function formatTimestamp(value: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return "recently";
  }
}

function defaultConfirmDelete(message: string): boolean {
  return typeof window !== "undefined" && window.confirm(message);
}
