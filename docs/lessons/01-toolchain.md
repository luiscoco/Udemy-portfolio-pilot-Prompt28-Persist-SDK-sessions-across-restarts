# Lesson 01 — Resolve the toolchain before coding

## Teaching goal

Show students how to pin a compatible stack from released package versions, registry peer/engine metadata, and official support policies before scaffolding an application.

## Walkthrough

1. Inspect the workspace and local commands: `node --version`, `npm --version`, `git --version`, `docker --version`, `docker compose version`, and `git status --short`. Record failures as well as successes.
2. Confirm the requested React release is stable from [React's release list](https://react.dev/versions). Pair exactly matching `react` and `react-dom` versions.
3. Check the Next.js React peer range, and check Node floors for [Next.js](https://nextjs.org/docs/app/getting-started/installation), [Vite](https://vite.dev/guide/), [Prisma](https://www.prisma.io/docs/orm/v7/reference/system-requirements), and [Vitest](https://main.vitest.dev/guide/migration/). The highest common floor is below Node 24.21.0.
4. Prefer a supported stable line when a registry `latest` tag points to a release candidate. Prisma 7.10.0 is the chosen line; `prisma` and `@prisma/client` stay matched.
5. Keep TypeScript at 5.9.3 because [Prisma's v7 guide](https://docs.prisma.io/docs/orm/v6/more/upgrades/to-v7) recommends 5.9.x. Newer TypeScript major releases need a separate compatibility check.
6. Record selected versions and rationale in `docs/versions.md`; express the runtime baseline in `.nvmrc`, `.npmrc`, and `package.json`. Add `.gitignore` before any credential or transcript files exist.

## Practical check

Once a working Node/npm session and milestone 02 manifests exist, use `npm install --package-lock-only --ignore-scripts`, then `npm install` and `npm ls` as shown in `docs/versions.md`. Inspect the installed Claude Agent SDK types before coding against them. Keep `package-lock.json` tracked when committing is authorized.

## Observed limitation

This Windows shell reports no active Node version, even though `nvm list` shows 24.21.0 installed. Direct registry access and the Docker engine are unavailable. These affect local package resolution and later database milestones, not the version research completed here.
