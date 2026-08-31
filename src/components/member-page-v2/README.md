# Member Page V2 Renderer

Server-renderable React components for V2 member pages. Zero client-side dependencies—no `use client`, TipTap, dnd-kit, upload, or editor code.

## Exports

```ts
import { MemberPageV2View } from "@/components/member-page-v2";
import type { MemberPageV2ViewProps, AssetMetadata } from "@/components/member-page-v2";
```

## Component API

```tsx
<MemberPageV2View
  document={validatedMemberPageDocumentV2}
  theme={resolvedThemeAccent}
  assetMetadata={assetMetadataMap}
/>
```

### Props

- **`document`**: `MemberPageDocumentV2` — A validated V2 document (frame + blocks).
- **`theme`**: `ResolvedMemberThemeAccent` — Resolved theme with semantic tokens.
- **`assetMetadata`**: `ReadonlyMap<string, AssetMetadata>` — Asset ID → verified width/height/mimeType.

### AssetMetadata

```ts
interface AssetMetadata {
  width: number;
  height: number;
  mimeType: string;
}
```

Member-uploaded asset sources are always same-origin `/member-assets/<assetId>`. HAM project artwork comes directly from the reviewed static project catalog. Documents never contain object keys, presigned URLs, or remote URLs.

## Design Intent

- **Paper theme parity**: Exact visual match to current member pages.
- **Fail closed**: Missing general-image metadata omits the image; missing external-project artwork uses the shared art-pending tile; no remote leakage.
- **Accessibility**: Decorative images use `alt=""`, informative images require non-empty alt text.
- **Semantic HTML**: Rich-text JSON renders to React elements; never `dangerouslySetInnerHTML`.
- **Safe links**: External links use `rel="noopener noreferrer"`.
- **Contained embeds**: Pasted iframe HTML is reduced to a validated HTTPS URL,
  title, and layout before storage. The renderer owns the iframe sandbox and
  permissions; member-authored HTML and attributes are never rendered.

## Supported Blocks

| Block Type | Variants | Notes |
|---|---|---|
| `richText` | — | Paragraph, H2/H3, lists, blockquotes, bold/italic/link. |
| `featuredProject` | `card`, `artwork-first` | HAM registry or external project. |
| `projectList` | `stacked`, `compact` | One or more HAM/external projects. |
| `additionalLinks` | `list`, `buttons` | Labeled HTTPS links with optional descriptions. |
| `image` | `framed`, `wide` | Single image with optional caption. |
| `gallery` | `grid`, `strip` | Two or more images with optional captions. |
| `calloutQuote` | `note`, `quote` | Plain text callout; `quote` supports attribution. |
| `embed` | `compact`, `standard`, `widescreen` | Sandboxed HTTPS iframe with a required accessible title and optional HAM frame. |

## Testing

Renderer tests verify:

- All frame fields and every block/variant render from canonical fixtures.
- Exactly one H1; H2/H3 rich-text semantics; React escaping; no dangerous HTML.
- HAM catalog artwork, external art-pending/member artwork states, safe link rels, same-origin upload paths, dimensions, and alt/decorative semantics.
- Missing asset metadata fails closed without remote/object-key leakage.
- Embed parsing drops provider HTML/attributes and rejects non-HTTPS sources;
  rendered iframes carry fixed sandbox, permissions, referrer policy, and lazy loading.
- Source-level assertion: no imports from editor, TipTap, dnd-kit, upload, or `use client`.

Run tests:

```sh
npm run test -- tests/unit/member-v2-renderer
```
