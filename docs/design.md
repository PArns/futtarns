# Design

freitach borrows park.fan's look without importing its code:

- **Type**: Geist (the `geist` package, loaded locally so Docker builds need no network).
- **Colour**: park.fan's tokens in `app/globals.css`, oklch values copied 1:1; primary
  `#2191D3`, accent green `#51CC64`. Dark is the default theme (`next-themes`, class based).
- **Glass**: hero plates use `glass-heavy`, cards `glass-tile`. Never animate or transform a
  glass panel or its ancestors, or its `backdrop-filter` stops working; animate children
  (`hero-item`). The header's glass is a sibling layer, not the `<header>` itself.
- **Page anatomy**: every page opens with `PageHero` on the brand gradient (sky gradient in
  light mode) and is split into sections with `ChapterHeading` (a faint number or icon,
  kicker, title, hint).
- **Phones first**: 44 px touch targets below `sm`, dialogs as native `<dialog>`, no `:has()`.
- **Mark**: `components/layout/brand.tsx`, park.fan's pin with a pizza slice.
