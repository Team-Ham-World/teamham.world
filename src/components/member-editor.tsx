"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import {
  updateMemberPageAction,
  type MemberEditorState,
} from "@/app/m/[member]/actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { PROJECTS, STATUS_LABELS, type ProjectStatus } from "@/data/projects";
import type { MemberPublicPage } from "@/lib/members/model";
import { MEMBER_LIMITS } from "@/lib/members/validation";
import { memberPath } from "@/lib/site";

const INITIAL_STATE: MemberEditorState = {
  status: "idle",
  message: "",
  fieldErrors: {},
};

const STATUSES = Object.keys(STATUS_LABELS) as ProjectStatus[];

type ShowcaseKind = "none" | "project" | "external";

const SHOWCASE_HELP: Record<ShowcaseKind, string> = {
  none: "The showcase section will stay off this page.",
  project: "Choose one project from HAM's current lineup.",
  external: "Add the details for a project outside the HAM lineup.",
};

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="mt-2 text-sm font-bold text-decorative-red">
      {message}
    </p>
  ) : null;
}

const INPUT_CLASS =
  "mt-2 min-h-11 w-full border-2 border-ink bg-paper px-3 py-2 text-ink outline-none transition-shadow focus:shadow-[3px_3px_0_0_var(--color-interactive-blue)]";

export function MemberEditor({ member }: { member: MemberPublicPage }) {
  const [state, action] = useActionState(updateMemberPageAction, INITIAL_STATE);
  const initialKind = member.showcase?.kind ?? "none";
  const [showcaseKind, setShowcaseKind] = useState<ShowcaseKind>(initialKind);
  const external = member.showcase?.kind === "external" ? member.showcase : null;

  return (
    <section
      id="edit-page"
      aria-labelledby="edit-page-heading"
      className="mt-16 border-t-2 border-ink pt-10"
    >
      <div className="flex max-w-3xl flex-wrap items-start justify-between gap-5">
        <div>
          <p className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
            Owner tools
          </p>
          <h2 id="edit-page-heading" className="font-display mt-2 text-3xl">
            Edit your page
          </h2>
          <p className="mt-3 max-w-prose leading-relaxed text-muted">
            Changes appear here immediately. An administrator controls whether the
            page is visible to everyone.
          </p>
        </div>
        <Link
          href={memberPath(member.slug)}
          className="inline-flex min-h-11 items-center font-bold text-interactive-blue underline underline-offset-4"
        >
          Done editing
        </Link>
      </div>

      <form
        action={action}
        onReset={(event) => {
          // Successful React form actions reset uncontrolled fields by default.
          // This editor stays open after saving, so keep its saved values visible.
          event.preventDefault();
        }}
        className="mt-8 max-w-3xl space-y-7"
        noValidate
      >
        <input type="hidden" name="slug" value={member.slug} />

        <div>
          <label htmlFor="displayName" className="font-bold">
            Display name
          </label>
          <input
            id="displayName"
            name="displayName"
            required
            maxLength={MEMBER_LIMITS.displayName}
            defaultValue={member.displayName}
            aria-describedby={state.fieldErrors.displayName ? "displayName-error" : undefined}
            className={INPUT_CLASS}
          />
          <FieldError id="displayName-error" message={state.fieldErrors.displayName} />
        </div>

        <div>
          <label htmlFor="blurb" className="font-bold">
            Short introduction <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="blurb"
            name="blurb"
            rows={5}
            maxLength={MEMBER_LIMITS.blurb}
            defaultValue={member.blurb ?? ""}
            aria-describedby={`blurb-help${state.fieldErrors.blurb ? " blurb-error" : ""}`}
            className={INPUT_CLASS}
          />
          <p id="blurb-help" className="mt-2 text-sm text-muted">
            Up to {MEMBER_LIMITS.blurb} characters, in your own words.
          </p>
          <FieldError id="blurb-error" message={state.fieldErrors.blurb} />
        </div>

        <div>
          <label htmlFor="websiteUrl" className="font-bold">
            Personal site <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="websiteUrl"
            name="websiteUrl"
            type="url"
            inputMode="url"
            maxLength={MEMBER_LIMITS.websiteUrl}
            placeholder="https://your-site.example"
            defaultValue={member.websiteUrl ?? ""}
            aria-describedby={state.fieldErrors.websiteUrl ? "websiteUrl-error" : undefined}
            className={INPUT_CLASS}
          />
          <FieldError id="websiteUrl-error" message={state.fieldErrors.websiteUrl} />
        </div>

        <fieldset className="border-2 border-ink bg-surface p-5 sm:p-6">
          <legend className="px-2 font-display text-xl">Showcase</legend>
          <label htmlFor="showcaseKind" className="font-bold">
            What should this page feature?
          </label>
          <select
            id="showcaseKind"
            name="showcaseKind"
            value={showcaseKind}
            onChange={(event) => {
              const nextKind = event.currentTarget.value;
              if (
                nextKind === "none" ||
                nextKind === "project" ||
                nextKind === "external"
              ) {
                setShowcaseKind(nextKind);
              }
            }}
            aria-controls={
              showcaseKind === "project"
                ? "showcase-project-fields"
                : showcaseKind === "external"
                  ? "showcase-external-fields"
                  : undefined
            }
            aria-describedby={`showcase-help${state.fieldErrors.showcase ? " showcase-error" : ""}`}
            className={INPUT_CLASS}
          >
            <option value="none">No showcase</option>
            <option value="project">A HAM project</option>
            <option value="external">Another project</option>
          </select>
          <p id="showcase-help" aria-live="polite" className="mt-3 text-sm text-muted">
            {SHOWCASE_HELP[showcaseKind]}
          </p>

          {showcaseKind === "project" ? (
            <div id="showcase-project-fields" className="mt-5 border-t-2 border-ink pt-5">
              <label htmlFor="projectSlug" className="font-bold">
                HAM project
              </label>
              <select
                id="projectSlug"
                name="projectSlug"
                defaultValue={member.showcase?.kind === "project" ? member.showcase.projectSlug : ""}
                className={INPUT_CLASS}
              >
                <option value="">Choose a project</option>
                {PROJECTS.map((project) => (
                  <option key={project.slug} value={project.slug}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {showcaseKind === "external" ? (
            <div
              id="showcase-external-fields"
              className="mt-5 grid gap-5 border-t-2 border-ink pt-5 sm:grid-cols-2"
            >
              <div>
                <label htmlFor="showcaseName" className="font-bold">Name</label>
                <input
                  id="showcaseName"
                  name="showcaseName"
                  maxLength={MEMBER_LIMITS.showcaseName}
                  defaultValue={external?.name ?? ""}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor="showcaseType" className="font-bold">Type</label>
                <input
                  id="showcaseType"
                  name="showcaseType"
                  maxLength={MEMBER_LIMITS.showcaseType}
                  placeholder="Game, tool, site…"
                  defaultValue={external?.type ?? ""}
                  className={INPUT_CLASS}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="showcaseDescription" className="font-bold">Description</label>
                <textarea
                  id="showcaseDescription"
                  name="showcaseDescription"
                  rows={4}
                  maxLength={MEMBER_LIMITS.showcaseDescription}
                  defaultValue={external?.shortDescription ?? ""}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label htmlFor="showcaseStatus" className="font-bold">Status</label>
                <select
                  id="showcaseStatus"
                  name="showcaseStatus"
                  defaultValue={external?.status ?? "planning"}
                  className={INPUT_CLASS}
                >
                  {STATUSES.map((status) => (
                    <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="showcaseUrl" className="font-bold">Project URL <span className="font-normal text-muted">(optional)</span></label>
                <input
                  id="showcaseUrl"
                  name="showcaseUrl"
                  type="url"
                  maxLength={MEMBER_LIMITS.websiteUrl}
                  defaultValue={external?.url ?? ""}
                  className={INPUT_CLASS}
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="showcaseImageUrl" className="font-bold">Artwork URL <span className="font-normal text-muted">(optional)</span></label>
                <input
                  id="showcaseImageUrl"
                  name="showcaseImageUrl"
                  type="url"
                  inputMode="url"
                  maxLength={MEMBER_LIMITS.websiteUrl}
                  placeholder="https://example.com/project-cover.jpg"
                  defaultValue={external?.imageUrl ?? ""}
                  aria-describedby="showcaseImageUrl-help"
                  className={INPUT_CLASS}
                />
                <p id="showcaseImageUrl-help" className="mt-2 text-sm text-muted">
                  Leave blank and we&apos;ll try the project URL&apos;s Open Graph image when you save.
                </p>
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="showcaseRepository" className="font-bold">Source URL <span className="font-normal text-muted">(optional)</span></label>
                <input
                  id="showcaseRepository"
                  name="showcaseRepository"
                  type="url"
                  maxLength={MEMBER_LIMITS.websiteUrl}
                  defaultValue={external?.repository ?? ""}
                  className={INPUT_CLASS}
                />
              </div>
            </div>
          ) : null}

          <FieldError id="showcase-error" message={state.fieldErrors.showcase} />
        </fieldset>

        <div className="flex flex-wrap items-center gap-4">
          <FormSubmitButton
            pendingLabel="Saving…"
            className="min-h-11 border-2 border-ink bg-ink px-6 py-2 font-bold tracking-[0.12em] text-paper uppercase shadow-[4px_4px_0_0_var(--color-muted)] transition-transform hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5"
          >
            Save page
          </FormSubmitButton>
          <p
            role="status"
            aria-live="polite"
            className={state.status === "error" ? "font-bold text-decorative-red" : "font-bold text-muted"}
          >
            {state.message}
          </p>
        </div>
      </form>
    </section>
  );
}
