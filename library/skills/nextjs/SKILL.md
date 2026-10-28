---
name: nextjs
version: "1.0.0"
description: Use when building or reviewing a Next.js application with the App Router. Covers Server Components, Server Actions, routing, layouts, data fetching, caching, middleware, and deployment. Use when the project has a next.config or app/ directory. Do not use for Pages Router or non-Next.js React apps.
---

# nextjs

Build Next.js App Router applications correctly. Server Components by default, client boundaries only where needed.

## Inputs

- The project root. Confirm `next` is in `package.json` dependencies.
- `next.config.*` and `app/` directory.

## Rules

1. **Server Components by default.** Add `"use client"` only for interactivity, browser APIs, or hooks. Never add it to a component that only renders data.
2. **Server Actions for mutations.** Use `"use server"` functions called from forms or event handlers. Validate input with zod. Never trust client-sent data.
3. **Async params.** In Next.js 15+, `params` and `searchParams` are Promises. Await them. Type them as `Promise<{...}>`.
4. **Data fetching in Server Components.** Fetch directly; no useEffect. Use `cache()` or the fetch cache. Revalidate with `revalidatePath` or `revalidateTag`.
5. **Route handlers** (`route.ts`) for webhooks and external API proxies. Return `NextResponse.json()`.
6. **Middleware** (`middleware.ts`) for auth redirects and locale detection. Keep it fast: no database calls.
7. **Images and fonts.** Use `next/image` and `next/font`. Set `sizes` and `priority` for LCP images.
8. **Error boundaries.** `error.tsx` per route segment. `not-found.tsx` for 404s. `loading.tsx` for Suspense.
9. **Metadata.** Export `metadata` or `generateMetadata` from page/layout files. Never set `<title>` manually.
10. **Deployment.** Default to Vercel. Set `output: "standalone"` for Docker. Environment variables must be prefixed `NEXT_PUBLIC_` to reach the client.

## Gotchas

- `"use client"` on a parent makes all children client components. Push the boundary as deep as possible.
- Server Actions must be in a file with `"use server"` at the top, or be async functions in a Server Component.
- `cookies()` and `headers()` are async in Next.js 15. Await them.
- `revalidateTag` requires the fetch to use `{ next: { tags: [...] } }`.
- Dynamic routes need `generateStaticParams` for static generation, or they render on demand.

## Finish

```yaml
agent: nextjs
job: next.js guidance for <scope>
status: complete
artifacts: []
findings: []
decisions_owed: []
next: none
```
