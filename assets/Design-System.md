# Information Hub v3 Design System

## Direction

- Theme: editorial reading desk + operator console
- Goal: make subscriptions feel like managed assets, not backend rows
- Memory point: soft teal highlights on warm white surfaces, with dense but readable cards

## Color

- Background: `#fffdf9` to `#f8fafc`
- Surface: `#ffffff`
- Border: `#e4e4e7`
- Primary accent: teal range around `#0f766e` / `#14b8a6`
- Signal colors:
  - High signal / success: emerald-teal
  - Warning / stale: amber
  - Error / blocked: rose
  - Metadata: zinc

## Typography

- Page eyebrow: uppercase, high tracking, `11px`
- Primary title: `text-2xl` to `text-3xl`, semibold
- Card title: `text-base` or `text-[15px]`, semibold
- Metrics: large numerals with compact support text
- Metadata: `10px` to `12px`, muted zinc

## Components

- Main cards use large rounded corners: `24px` to `32px`
- Surfaces prefer soft shadow over hard borders
- Metric chips must be scannable in one glance
- Source cards should always expose:
  - source identity
  - unread / entry backlog
  - latest entry
  - strategy controls
  - quick actions into feed

## Spacing

- Use 4px / 8px rhythm
- Keep dense information inside grouped blocks instead of long single rows
- Prefer `gap-2`, `gap-3`, `gap-4` over custom spacing
