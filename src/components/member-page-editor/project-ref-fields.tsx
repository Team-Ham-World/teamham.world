"use client";

import { useState } from "react";

import type {
  MemberImageRef,
  MemberProjectRef,
  MemberProjectStatus,
} from "@/lib/members/v2/document";
import { STATUS_LABELS } from "@/data/projects";

import type { EditorAsset } from "./asset-api";
import { buildReadyImageRef, type ImageUseDraft } from "./asset-model";
import {
  EDITOR_FIELD_LIMITS,
  EDITOR_PROJECT_STATUSES,
  HAM_PROJECT_CHOICES,
  buildExternalProjectRef,
  buildHamProjectRef,
  hamProjectFacts,
  isLikelyHttpsUrl,
  withExternalProjectArtwork,
} from "./block-catalog";
import {
  EDITOR_CONTROL,
  EDITOR_HINT,
  EDITOR_LABEL,
  EDITOR_PRIMARY_CONTROL,
  SelectField,
  TextAreaField,
  TextField,
} from "./editor-controls";
import {
  ImageDraftFields,
  ImageReferenceFields,
  emptyImageUseDraft,
} from "./image-fields";

const STATUS_OPTIONS = EDITOR_PROJECT_STATUSES.map((status) => ({
  value: status,
  label: STATUS_LABELS[status],
}));

/**
 * Editor for one project reference.
 *
 * A HAM reference stores only a slug; its facts stay read-only and come from
 * the reviewed registry. External projects carry their own validated fields.
 */
export function ProjectRefFields({
  idPrefix,
  project,
  assets,
  onChange,
}: {
  idPrefix: string;
  project: MemberProjectRef;
  assets: readonly EditorAsset[];
  onChange: (project: MemberProjectRef) => void;
}) {
  const kind = project.kind;

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className={EDITOR_LABEL}>Project source</legend>
        <div className="mt-3 flex flex-wrap gap-4">
          {(
            [
              { value: "ham", label: "HAM project" },
              { value: "external", label: "Outside HAM" },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className="inline-flex min-h-11 items-center gap-2 text-sm font-bold"
            >
              <input
                type="radio"
                name={`${idPrefix}-kind`}
                value={option.value}
                checked={kind === option.value}
                onChange={() => {
                  if (option.value === kind) return;
                  onChange(
                    option.value === "ham"
                      ? buildHamProjectRef(HAM_PROJECT_CHOICES[0]?.slug ?? "")
                      : buildExternalProjectRef({
                          name: "",
                          shortDescription: "",
                          type: "",
                          status: "in-development",
                          url: "",
                          repository: "",
                        }),
                  );
                }}
                className="size-5"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      {kind === "ham" ? (
        <HamProjectFields
          idPrefix={idPrefix}
          projectSlug={project.projectSlug}
          onChange={(projectSlug) => onChange(buildHamProjectRef(projectSlug))}
        />
      ) : (
        <ExternalProjectFields
          idPrefix={idPrefix}
          project={project}
          assets={assets}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function HamProjectFields({
  idPrefix,
  projectSlug,
  onChange,
}: {
  idPrefix: string;
  projectSlug: string;
  onChange: (projectSlug: string) => void;
}) {
  const facts = hamProjectFacts(projectSlug);

  return (
    <div>
      <SelectField
        id={`${idPrefix}-ham-slug`}
        label="HAM project"
        value={projectSlug}
        options={HAM_PROJECT_CHOICES.map((project) => ({
          value: project.slug,
          label: project.name,
        }))}
        onChange={onChange}
      />
      {facts ? (
        <dl className="mt-4 border-2 border-ink bg-paper p-4 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-bold">Type</dt>
            <dd className="text-muted">{facts.type}</dd>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-2">
            <dt className="font-bold">Status</dt>
            <dd className="text-muted">{STATUS_LABELS[facts.status]}</dd>
          </div>
          <div className="mt-2">
            <dt className="font-bold">Description</dt>
            <dd className="mt-1 leading-relaxed text-muted">
              {facts.shortDescription}
            </dd>
          </div>
          <p className={EDITOR_HINT}>
            These facts come from HAM&apos;s project catalog and stay read-only here.
          </p>
        </dl>
      ) : (
        <p className="mt-3 flex items-start gap-2 border-l-4 border-decorative-red pl-2 text-sm font-bold text-ink">
          <span aria-hidden="true" className="text-decorative-red">&#9888;</span>
          <span>Pick a project from the current catalog.</span>
        </p>
      )}
    </div>
  );
}

function ExternalProjectFields({
  idPrefix,
  project,
  assets,
  onChange,
}: {
  idPrefix: string;
  project: Extract<MemberProjectRef, { kind: "external" }>;
  assets: readonly EditorAsset[];
  onChange: (project: MemberProjectRef) => void;
}) {
  /**
   * Text is stored exactly as typed, spaces included, so a multi-word name can
   * actually be written. The add flow tidies whitespace only when the owner
   * confirms the new block; existing block edits remain untouched while typed.
   */
  const update = (patch: Partial<{
    name: string;
    shortDescription: string;
    type: string;
    status: MemberProjectStatus;
    url: string;
    repository: string;
  }>) =>
    onChange(
      buildExternalProjectRef({
        name: patch.name ?? project.name,
        shortDescription: patch.shortDescription ?? project.shortDescription,
        type: patch.type ?? project.type,
        status: patch.status ?? project.status,
        url: patch.url ?? project.url ?? "",
        repository: patch.repository ?? project.repository ?? "",
        artwork: project.artwork,
      }),
    );

  const urlError =
    project.url && !isLikelyHttpsUrl(project.url)
      ? "Use a full https:// address."
      : undefined;
  const repositoryError =
    project.repository && !isLikelyHttpsUrl(project.repository)
      ? "Use a full https:// address."
      : undefined;

  return (
    <div className="space-y-5">
      <TextField
        id={`${idPrefix}-name`}
        label="Project name"
        value={project.name}
        maxLength={EDITOR_FIELD_LIMITS.projectName}
        error={project.name.trim() === "" ? "Add the project name." : undefined}
        onChange={(name) => update({ name })}
      />
      <TextField
        id={`${idPrefix}-type`}
        label="Type"
        value={project.type}
        maxLength={EDITOR_FIELD_LIMITS.projectType}
        hint="For example: game, tool, zine."
        error={project.type.trim() === "" ? "Add a short type label." : undefined}
        onChange={(type) => update({ type })}
      />
      <TextAreaField
        id={`${idPrefix}-description`}
        label="Short description"
        value={project.shortDescription}
        maxLength={EDITOR_FIELD_LIMITS.projectDescription}
        error={
          project.shortDescription.trim() === ""
            ? "Describe the project in a sentence or two."
            : undefined
        }
        onChange={(shortDescription) => update({ shortDescription })}
      />
      <SelectField
        id={`${idPrefix}-status`}
        label="Status"
        value={project.status}
        options={STATUS_OPTIONS}
        onChange={(status) => update({ status: status as MemberProjectStatus })}
      />
      <TextField
        id={`${idPrefix}-url`}
        label="Project link"
        optional
        type="url"
        inputMode="url"
        value={project.url ?? ""}
        maxLength={EDITOR_FIELD_LIMITS.url}
        error={urlError}
        onChange={(url) => update({ url })}
      />
      <TextField
        id={`${idPrefix}-repository`}
        label="Source code link"
        optional
        type="url"
        inputMode="url"
        value={project.repository ?? ""}
        maxLength={EDITOR_FIELD_LIMITS.url}
        error={repositoryError}
        onChange={(repository) => update({ repository })}
      />
      <ExternalProjectArtworkFields
        idPrefix={idPrefix}
        artwork={project.artwork}
        assets={assets}
        onChange={(artwork) =>
          onChange(withExternalProjectArtwork(project, artwork))
        }
      />
    </div>
  );
}

function ExternalProjectArtworkFields({
  idPrefix,
  artwork,
  assets,
  onChange,
}: {
  idPrefix: string;
  artwork?: MemberImageRef;
  assets: readonly EditorAsset[];
  onChange: (artwork: MemberImageRef | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<ImageUseDraft>(() => emptyImageUseDraft());
  const readyArtwork = buildReadyImageRef(draft, assets);

  function resetAddFlow(): void {
    setAdding(false);
    setDraft(emptyImageUseDraft());
  }

  return (
    <div>
      <p className={EDITOR_LABEL}>
        Project artwork
        <span className="font-normal text-muted"> (optional)</span>
      </p>
      <p className={EDITOR_HINT}>
        Artwork comes from one verified image in this page&apos;s asset library.
      </p>

      {artwork ? (
        <div className="mt-3 space-y-5 border-2 border-ink bg-paper p-4">
          <ImageReferenceFields
            idPrefix={`${idPrefix}-artwork`}
            image={artwork}
            assets={assets}
            onChange={onChange}
          />
          <button
            type="button"
            className={EDITOR_CONTROL}
            onClick={() => onChange(null)}
          >
            Remove project artwork
          </button>
        </div>
      ) : adding ? (
        <div className="mt-3 border-2 border-dashed border-ink bg-paper p-4">
          <ImageDraftFields
            idPrefix={`${idPrefix}-new-artwork`}
            draft={draft}
            assets={assets}
            onChange={setDraft}
          />
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className={EDITOR_PRIMARY_CONTROL}
              disabled={!readyArtwork}
              onClick={() => {
                if (!readyArtwork) return;
                onChange(readyArtwork);
                resetAddFlow();
              }}
            >
              Use as project artwork
            </button>
            <button
              type="button"
              className={EDITOR_CONTROL}
              onClick={resetAddFlow}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`${EDITOR_CONTROL} mt-3`}
          onClick={() => setAdding(true)}
        >
          Add project artwork
        </button>
      )}
    </div>
  );
}
