---
name: frontend
version: "1.0.0"
description: Use when building or reviewing frontend UI in a SaaS app. Detects the workspace stack (React, Next.js, Vue, Svelte) and component library (shadcn/ui, Radix, MUI, Chakra). Uses shadcn components and design tokens. Use when the task involves UI components, layouts, forms, tables, modals, or styling. Do not use for backend or API work.
---

# frontend

Build frontend UI that matches the project's stack and component conventions. Detect first, then build.

## Inputs

- The project root. Read `package.json` for framework and UI library.
- If the project uses Next.js, coordinate with the `nextjs` agent for routing, data fetching, and Server/Client boundaries.
- `components.json` if it exists (shadcn configuration).
- `tailwind.config.*` or CSS variables for design tokens.

## Stack detection

1. **Framework.** Check `package.json` dependencies: `next` (Next.js), `react` (React), `vue` (Vue), `svelte` (SvelteKit). If multiple, note the primary.
2. **UI library.** Check for `@radix-ui/*`, `@mui/*`, `@chakra-ui/*`, or `shadcn` in dependencies. Check for `components.json` (shadcn).
3. **Styling.** Tailwind (`tailwindcss`), CSS modules, or styled-components.
4. **State.** Check for `zustand`, `redux`, `jotai`, `pinia`, or React Context usage.

## When shadcn/ui is present

- Use `npx shadcn@latest add <component>` to add components. Do not hand-write what shadcn provides.
- Compose with `cva` variants and `cn()` for conditional classes.
- Use semantic design tokens (`bg-background`, `text-foreground`), never hardcoded colors.
- Check `components.json` for the `style` (default, new-york) and `iconLibrary`.

## When shadcn is not present

- Use the project's existing component library. Do not introduce shadcn without asking.
- Follow the existing patterns for variants, spacing, and theming.

## General rules

1. **Accessible by default.** Labels, focus states, keyboard navigation, ARIA where needed.
2. **Responsive.** Mobile-first with Tailwind breakpoints. Test at 375px, 768px, 1024px, 1440px.
3. **Loading and empty states.** Every data-driven component needs skeleton, empty, and error states.
4. **Forms.** Use react-hook-form + zod with shadcn Form components. Inline errors, accessible fields.
5. **Tables.** TanStack Table + shadcn Table. Sorting, filtering, pagination, selection.

## Gotchas

- Do not mix component libraries. If the project uses shadcn, do not add MUI components.
- shadcn components are copied into the project, not imported from a package. Edit them in place.
- `components.json` must exist before running `shadcn add`. If it doesn't, run `shadcn init` first.
- Dark mode requires CSS variables for both light and dark themes. Check `globals.css`.

## Finish

```yaml
agent: frontend
job: frontend UI for <scope>
status: complete
artifacts: []
findings: []
decisions_owed: []
next: none
```
