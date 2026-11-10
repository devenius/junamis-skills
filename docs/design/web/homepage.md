---
surface_id: web/homepage
app: web
kind: web
status: draft
version: 0.1.0
owner: library/frontend
code_paths: []
depends_on: []
related_tasks: []
last_reviewed: 2026-11-10
design_checksum: sha256:2b2b25ce85e876aa61e9b9ae11b905257a9e6f9bce2163d0d4b460e335aa8c28
last_reviewed_commit: 2c5c3d607fbba992c77a5cff83daf7113dd41cf1
---

## Intent

The homepage is the default public landing surface. It introduces the product,
shows the primary call to action, and hands the visitor to the next useful
surface without requiring a sign-in.

## Current state

Nothing is implemented yet. This file is the intended contract for the
homepage: a component tree, one public route, the data it needs, and the
accessibility work that must ship with it. No code path is claimed until the
page exists.

## Known gaps

- Build the HomePage component tree and the public `/` route.
- Decide the hero headline and the primary call to action.
- Confirm which visitor data, if any, may be loaded on first paint.
- Run the accessibility checks before this surface becomes active.

## Structure

- HomePage
  - Header
    - Logo
    - Navigation
  - Hero
    - HeroHeadline
    - HeroSubhead
    - HeroCTA
  - FeatureGrid
    - FeatureCard ×3
  - Footer

## Routes

| path | component | auth | notes |
|------|-----------|------|-------|
| `/` | HomePage | public | default landing |

## State & data

| name | source | shape | notes |
|------|--------|-------|-------|
| `viewer` | api/get-user | `{id, name, email}` | optional; only when signed in |

## Props & events

| component | props | events |
|-----------|-------|--------|
| Hero | `{headline, subhead, cta}` | `onCtaClick` |
| FeatureGrid | `{features}` | none |

## Accessibility

The page needs one `h1`, keyboard-reachable navigation, and visible focus on
the primary call to action. Automated checks and a manual keyboard pass are
required before this surface becomes active.

## Change log

- 2026-11-10 · v0.1.0 · Created draft surface · bootstrap · library/document
