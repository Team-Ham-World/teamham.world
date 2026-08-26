"use client";

/**
 * Shared editor chrome primitives.
 *
 * HAM Paper system: hard 2px borders, offset shadows, no radii. Selection,
 * focus, and error each carry a non-color signal (a left rule, the platform
 * focus ring, and a warning glyph plus text) so none of the three depends on
 * hue alone.
 */

export const EDITOR_CONTROL =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 border-2 border-ink bg-surface px-3 py-2 text-sm font-bold text-ink transition-[transform,background-color,color,box-shadow] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-interactive-blue hover:-translate-y-0.5 hover:bg-ink hover:text-paper active:translate-x-0.5 active:translate-y-0.5 disabled:cursor-not-allowed disabled:border-muted disabled:bg-paper disabled:text-muted disabled:hover:translate-y-0 disabled:hover:bg-paper disabled:hover:text-muted motion-reduce:transform-none motion-reduce:transition-none";

export const EDITOR_PRIMARY_CONTROL =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 border-2 border-ink bg-ink px-5 py-3 text-sm font-bold tracking-wider text-paper uppercase shadow-[4px_4px_0_0_var(--color-muted)] transition-[transform,background-color,color] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-interactive-blue hover:-translate-y-0.5 hover:bg-surface hover:text-ink active:translate-x-0.5 active:translate-y-0.5 disabled:cursor-not-allowed disabled:border-muted disabled:bg-paper disabled:text-muted disabled:shadow-none disabled:hover:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none";

/**
 * Compact chrome control.
 *
 * Same 44px touch target and same focus ring as `EDITOR_CONTROL`, drawn at a
 * lower altitude: a 1px hairline instead of the 2px content rule, so a strip
 * of editor affordances never competes with the member's own page.
 */
export const EDITOR_QUIET_CONTROL =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 border border-ink/45 bg-surface px-3 text-sm font-bold text-ink transition-[background-color,color,border-color] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-interactive-blue hover:border-ink hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:border-muted/40 disabled:bg-paper disabled:text-muted disabled:hover:bg-paper disabled:hover:text-muted motion-reduce:transition-none";

/** Icon-only variant of {@link EDITOR_QUIET_CONTROL}; needs an aria-label. */
export const EDITOR_ICON_CONTROL =
  "inline-flex size-11 min-h-11 min-w-11 shrink-0 items-center justify-center border border-ink/45 bg-surface text-ink transition-[background-color,color,border-color] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-interactive-blue hover:border-ink hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:border-muted/40 disabled:bg-paper disabled:text-muted disabled:hover:bg-paper disabled:hover:text-muted motion-reduce:transition-none";

export const EDITOR_INPUT =
  "mt-2 min-h-11 w-full min-w-0 max-w-full border-2 border-ink bg-paper px-3 py-2 text-ink outline-none transition-shadow aria-[invalid=true]:border-decorative-red focus:shadow-[3px_3px_0_0_var(--color-interactive-blue)] motion-reduce:transition-none";

export const EDITOR_LABEL = "block text-sm font-bold text-ink";

export const EDITOR_HINT = "mt-2 text-sm leading-relaxed text-muted";

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p
      id={id}
      className="mt-2 flex items-start gap-2 border-l-4 border-decorative-red pl-2 text-sm font-bold text-ink"
    >
      <span aria-hidden="true" className="mt-px text-decorative-red">
        &#9888;
      </span>
      <span>{message}</span>
    </p>
  );
}

export function InspectorSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t-2 border-ink pt-5 first:border-t-0 first:pt-0">
      <h4 className="text-xs font-bold tracking-[0.18em] text-muted uppercase">
        {title}
      </h4>
      {description ? <p className={EDITOR_HINT}>{description}</p> : null}
      <div className="mt-4 space-y-5">{children}</div>
    </section>
  );
}

/**
 * A control the owner can see but cannot use yet.
 *
 * Grounded copy over a hidden feature: the reason states what is missing and
 * when it arrives, and the disabled state is conveyed to assistive technology.
 */
export function UnavailableControl({
  label,
  reason,
}: {
  label: string;
  reason: string;
}) {
  return (
    <div className="border-2 border-dashed border-muted bg-paper p-4">
      <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink">
        {label}
        <span className="border-2 border-muted px-2 py-0.5 text-[0.65rem] tracking-[0.14em] text-muted uppercase">
          Not available yet
        </span>
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted">{reason}</p>
    </div>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  onBlur,
  maxLength,
  hint,
  error,
  optional = false,
  type = "text",
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  maxLength?: number;
  hint?: string;
  error?: string;
  optional?: boolean;
  type?: "text" | "url";
  inputMode?: "url" | "text";
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div>
      <label htmlFor={id} className={EDITOR_LABEL}>
        {label}
        {optional ? <span className="font-normal text-muted"> (optional)</span> : null}
      </label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        className={EDITOR_INPUT}
      />
      {hint ? (
        <p id={`${id}-hint`} className={EDITOR_HINT}>
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function TextAreaField({
  id,
  label,
  value,
  onChange,
  onBlur,
  maxLength,
  hint,
  error,
  rows = 4,
  optional = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  maxLength?: number;
  hint?: string;
  error?: string;
  rows?: number;
  optional?: boolean;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div>
      <label htmlFor={id} className={EDITOR_LABEL}>
        {label}
        {optional ? <span className="font-normal text-muted"> (optional)</span> : null}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : undefined}
        className={EDITOR_INPUT}
      />
      {hint ? (
        <p id={`${id}-hint`} className={EDITOR_HINT}>
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className={EDITOR_LABEL}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={EDITOR_INPUT}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={`${id}-hint`} className={EDITOR_HINT}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
