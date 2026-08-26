"use client";

import { useState } from "react";

import type { MemberPageDocumentV2, SocialPlatformId } from "@/lib/members/v2/document";
import { SOCIAL_PLATFORMS } from "@/lib/members/socials";
import {
  MAX_DISPLAY_NAME_CHARS,
  MAX_SUMMARY_CHARS,
  MAX_URL_CHARS,
} from "@/lib/members/v2/limits";
import {
  getEnabledMemberThemes,
  resolveEnabledThemeAccent,
} from "@/lib/members/v2/themes";
import themeStyles from "@/components/member-page-v2/MemberPageV2View.module.css";
import { memberThemeStyle } from "@/components/member-page-v2/member-theme-presentation";

import { isLikelyHttpsUrl } from "./block-catalog";
import type { EditorAsset } from "./asset-api";
import { buildReadyImageRef, type ImageUseDraft } from "./asset-model";
import {
  EDITOR_CONTROL,
  EDITOR_PRIMARY_CONTROL,
  InspectorSection,
  SelectField,
  TextAreaField,
  TextField,
} from "./editor-controls";
import {
  ImageDraftFields,
  ImageReferenceFields,
  emptyImageUseDraft,
} from "./image-fields";

/**
 * Frame inspector.
 *
 * Website and socials live here permanently: they are part of the fixed
 * profile treatment, and an Additional links block never replaces them.
 */
export function FrameInspector({
  frame,
  assets,
  onChange,
}: {
  frame: MemberPageDocumentV2["frame"];
  assets: readonly EditorAsset[];
  onChange: (patch: Partial<MemberPageDocumentV2["frame"]>) => void;
}) {
  const [addingPortrait, setAddingPortrait] = useState(false);
  const [portraitDraft, setPortraitDraft] = useState<ImageUseDraft>(() =>
    emptyImageUseDraft(),
  );
  const websiteError =
    frame.websiteUrl && !isLikelyHttpsUrl(frame.websiteUrl)
      ? "Use a full https:// address."
      : undefined;

  const enabledThemes = getEnabledMemberThemes();
  const selectedTheme = enabledThemes.find(
    (theme) => theme.id === frame.theme.id,
  );
  const selectedAccent = resolveEnabledThemeAccent(
    frame.theme.id,
    frame.theme.accentId,
  );
  if (!selectedTheme || !selectedAccent) {
    throw new Error("Frame inspector received an unavailable theme/accent pair.");
  }

  return (
    <div className="space-y-6">
      <InspectorSection title="Identity">
        <TextField
          id="frame-display-name"
          label="Display name"
          value={frame.displayName}
          maxLength={MAX_DISPLAY_NAME_CHARS}
          onChange={(value) => onChange({ displayName: value })}
          error={
            frame.displayName.trim() === "" ? "Add the name for your page." : undefined
          }
        />
        <TextAreaField
          id="frame-summary"
          label="Short introduction"
          optional
          rows={5}
          value={frame.summary ?? ""}
          maxLength={MAX_SUMMARY_CHARS}
          hint={`Up to ${MAX_SUMMARY_CHARS} characters. This is the text the members directory shows.`}
          onChange={(value) => onChange({ summary: value === "" ? null : value })}
        />
        <div>
          <p className="text-sm font-bold text-ink">Portrait</p>
          {frame.portrait ? (
            <div className="mt-3 space-y-4 border-2 border-ink bg-paper p-4">
              <ImageReferenceFields
                idPrefix="frame-portrait"
                image={frame.portrait}
                assets={assets}
                onChange={(portrait) => onChange({ portrait })}
              />
              <button
                type="button"
                className={EDITOR_CONTROL}
                onClick={() => onChange({ portrait: null })}
              >
                Remove portrait from page
              </button>
            </div>
          ) : addingPortrait ? (
            <div className="mt-3 border-2 border-ink bg-paper p-4">
              <ImageDraftFields
                idPrefix="new-frame-portrait"
                draft={portraitDraft}
                assets={assets}
                onChange={setPortraitDraft}
              />
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={EDITOR_PRIMARY_CONTROL}
                  disabled={!buildReadyImageRef(portraitDraft, assets)}
                  onClick={() => {
                    const portrait = buildReadyImageRef(portraitDraft, assets);
                    if (!portrait) return;
                    onChange({ portrait });
                    setAddingPortrait(false);
                    setPortraitDraft(emptyImageUseDraft());
                  }}
                >
                  Use as portrait
                </button>
                <button
                  type="button"
                  className={EDITOR_CONTROL}
                  onClick={() => {
                    setAddingPortrait(false);
                    setPortraitDraft(emptyImageUseDraft());
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`${EDITOR_CONTROL} mt-3`}
              onClick={() => setAddingPortrait(true)}
            >
              Add portrait
            </button>
          )}
        </div>
      </InspectorSection>

      <InspectorSection
        title="Website"
        description="Your main link. It keeps its place at the top of the page."
      >
        <TextField
          id="frame-website"
          label="Personal site"
          optional
          type="url"
          inputMode="url"
          value={frame.websiteUrl ?? ""}
          maxLength={MAX_URL_CHARS}
          error={websiteError}
          onChange={(value) => onChange({ websiteUrl: value === "" ? null : value })}
        />
      </InspectorSection>

      <InspectorSection
        title="Social profiles"
        description="Shown as stickers beside your site link."
      >
        {SOCIAL_PLATFORMS.map((platform) => {
          const id = platform.id as SocialPlatformId;
          const value = frame.socialLinks[id] ?? "";
          const error =
            value !== "" && !isLikelyHttpsUrl(value)
              ? "Use a full https:// address."
              : undefined;

          return (
            <TextField
              key={id}
              id={`frame-social-${id}`}
              label={platform.label}
              optional
              type="url"
              inputMode="url"
              value={value}
              maxLength={MAX_URL_CHARS}
              error={error}
              onChange={(next) => {
                const socialLinks = { ...frame.socialLinks };
                if (next.trim() === "") delete socialLinks[id];
                else socialLinks[id] = next;
                onChange({ socialLinks });
              }}
            />
          );
        })}
      </InspectorSection>

      <InspectorSection
        title="Theme"
        description="Choose one reviewed HAM treatment. Theme changes stay in your private draft until you publish."
      >
        <SelectField
          id="frame-theme"
          label="Page theme"
          value={frame.theme.id}
          options={enabledThemes.map((theme) => ({
            value: theme.id,
            label: `${theme.label}${theme.id === "paper" ? " (default)" : ""}`,
          }))}
          onChange={(value) => {
            const theme = enabledThemes.find((candidate) => candidate.id === value);
            if (!theme) return;
            onChange({
              theme: { id: theme.id, accentId: theme.defaultAccentId },
            });
          }}
        />
        <SelectField
          id="frame-accent"
          label="Accent"
          value={frame.theme.accentId}
          options={Object.entries(selectedTheme.accents).map(
            ([accentId, accent]) => ({ value: accentId, label: accent.label }),
          )}
          hint={selectedTheme.description}
          onChange={(accentId) => {
            if (!Object.hasOwn(selectedTheme.accents, accentId)) return;
            onChange({ theme: { id: selectedTheme.id, accentId } });
          }}
        />
        <ThemePreview theme={selectedAccent} />
      </InspectorSection>
    </div>
  );
}

function ThemePreview({
  theme,
}: {
  theme: NonNullable<ReturnType<typeof resolveEnabledThemeAccent>>;
}) {
  return (
    <div>
      <p className="text-sm font-bold text-ink">Preview</p>
      <div
        role="img"
        aria-label={`${theme.themeLabel}, ${theme.accentLabel} preview`}
        data-theme-preview="true"
        data-member-theme-surface="true"
        data-theme-scope="panel"
        data-theme-id={theme.themeId}
        data-accent-id={theme.accentId}
        className={`${themeStyles.themeSurface} mt-2 overflow-hidden border-2 border-ink p-3 shadow-[3px_3px_0_0_var(--color-ink)]`}
        style={memberThemeStyle(theme)}
      >
        <div className="flex items-end justify-between gap-3 border-b-2 border-ink pb-2">
          <span className="text-[0.65rem] font-bold tracking-[0.16em] text-muted uppercase">
            HAM member
          </span>
          <span className="size-3 bg-decorative-red" aria-hidden="true" />
        </div>
        <p className="font-display mt-3 text-xl leading-none text-ink">Aa</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="h-2 flex-1 bg-muted" aria-hidden="true" />
          <span
            className="border-2 border-ink bg-interactive-blue px-2 py-1 text-[0.65rem] font-bold text-paper uppercase"
            aria-hidden="true"
          >
            Link
          </span>
        </div>
      </div>
    </div>
  );
}
