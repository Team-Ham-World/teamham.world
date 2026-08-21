# teamham.world

Public source repository for [teamham.world](https://teamham.world).

## Tech Stack

- [Next.js](https://nextjs.org/) (App Router)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [ESLint](https://eslint.org/)

## Getting Started

### Prerequisites

- Node.js `>=24 <25` (see `.nvmrc`)
- npm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open [https://localhost:3000](https://localhost:3000) to view the application.

The dev server runs over HTTPS deliberately. `APP_BASE_URL` is
`https://localhost:3000`, the session cookies are `__Host-`/`Secure`, and the
logout route requires the request `Origin` to match `APP_BASE_URL` exactly — so
serving dev over plain http breaks sign-in and logout with origin errors.

The first run generates a local certificate into `certificates/` via `mkcert`
and may prompt for your password. Later runs reuse it. The directory is
gitignored and must not be committed.

If you see `Failed to generate self-signed certificate. Falling back to http.`,
fix the certificate rather than browsing over http — the fallback is what
produces those origin errors.

## Validation & Scripts

- `npm run lint` - Run ESLint checks
- `npm run typecheck` - Run TypeScript type checking (`tsc --noEmit`)
- `npm run build` - Build the production bundle
- `npm run start` - Start the production server

## Project Structure

- `src/app/` - Root layout, metadata, global styles and design tokens
- `src/components/` - Project shelf (server) and disclosure control (client)
- `src/data/projects.ts` - Typed public project catalog
- `src/app/fonts/` - Drop point for the approved WOFF2 files (see its README)

## Note

Content and design are governed privately. Two production assets are still
outstanding and are tracked as acceptance gates:

- **Fonts**: Bagel Fat One and Atkinson Hyperlegible are not yet self-hosted;
  the site currently renders with the approved fallback stacks. See
  [`src/app/fonts/README.md`](src/app/fonts/README.md).
- **Wordmark**: the canonical physical cut-and-scan wordmark, favicon, and
  OpenGraph image are not yet produced. The hero shows a plainly labeled text
  placeholder in the meantime.
