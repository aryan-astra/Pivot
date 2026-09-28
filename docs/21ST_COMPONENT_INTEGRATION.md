# 21st.dev Component Integration Rules (PIVOT)

Process for incoming component code (21st.dev, Framer Marketplace, or raw
snippets) — do not invent components ourselves. Inspect, adapt, verify. Each
arrival is recorded in the integration log at the bottom of this file.

## 1. Inspect before integrating

For each candidate component, determine and record:
- Framework and language (must be React + TypeScript to fit; otherwise adapt or reject)
- Dependencies (do any duplicate `framer-motion`, `lucide-react`, `clsx`/`tailwind-merge`? Resolve conflicts — never run two animation or icon stacks)
- CSS assumptions (Tailwind v4 theme tokens in `frontend/src/index.css` are canonical: `--color-paper/ink/line-*`, `--color-ok/warn/danger/info/fence`, `font-display`/`font-mono`; no global CSS resets or competing token sets)
- Animation system (project uses `framer-motion` + a few keyframe utilities with `prefers-reduced-motion` support — keep it that way)
- Responsive behavior (mobile-first; inspector switches `inline ≥1280px` / `overlay` below — components must work in both, down to 360px, no page-level horizontal overflow)
- Accessibility (keyboard operability, focus-visible states, ARIA roles/labels, live regions where status changes; test with keyboard only)
- Interaction model (controlled vs uncontrolled; must plug into existing state, not introduce a parallel store)

## 2. Preserve existing functionality

These must keep working after any integration (re-verify each, in a real browser):
- Runtime event stream and task graph rendering (`App.tsx` stream derivation)
- Network/embedded contract translation (`runtime/api.ts` — backend dialect stays)
- Samsung Dev mode inspector (all sections, both variants)
- WebSocket endpoint availability and HTTP polling fallback
- Responsive layout (desktop / laptop / tablet / mobile viewports)
- Interruption → impact → recovery flow end to end

## 3. Adapt, don't paste

- Restyle to PIVOT tokens and restrained visual language (ink/paper, quiet borders, status colors only for state; no neon, no heavy gradients, no glow).
- Follow existing conventions: `@/` imports, `cn()` for classes, `SectionLabel`/`Tag`/`StateChip`/`StatusGlyph` primitives in `components/ui.tsx`, `MotionConfig reducedMotion="user"`.
- Match component boundaries (`Composer`, `Stream`, `Execution`, `Impact`, `Inspector`); don't smear responsibilities.
- Keep the composer textarea at `16px` below the `md` breakpoint (prevents iOS focus zoom).

## 4. Selectivity

Use only components that materially improve hierarchy, interaction, feedback,
navigation, visualization, or perceived quality. Concrete recorded opportunities
(pre-integration audit):
- Execution graph is a flat list — a real DAG visualization could help if readable at 400px and mobile-safe
- Impact card is numeric only — small constraint-level diff display could help if truthful to `state.updated` payloads
- Notice stack and empty-state example list are functional but plain

Avoid component spam. PIVOT stays visually coherent and intentional.

## 5. Verify after integration

`npm run typecheck`, `npm run build`, backend `pytest`, real-browser flow
(message → mid-run interrupt → recovery), console-error check, backend-log
check, mobile viewport + keyboard + reduced-motion pass, production (`/`)
served-mode check.

## 6. Integration log

### 2026-09-28 — Framer Marketplace decorative bundle (5 modules)

Provided as `framer.com/m/*.js` asset URLs; each resolves to a
`framerusercontent.com` module.

| Module | What it is | Outcome |
| --- | --- | --- |
| `Interaction_Lines_Background` ("Reactive Lines" by Karim Saif) | Canvas line field that reacts to the pointer and orbits when idle | Ported → `frontend/src/components/InteractionLines.tsx` |
| `Home` | House glyph (fill + heavy stroke + door) | Ported → `HomeGlyph` in `frontend/src/components/Glyphs.tsx` |
| `Shape 1` (40×40) | Four-point sparkle | Ported → `SparkleGlyph` |
| `Shape 1` (256×256) | Eight-arm starburst | Ported → `CrossGlyph` |
| `Vector` | Looping swirl stroke | Ported → `SwirlGlyph` |

Inspection: React + TypeScript, no state or data coupling. All five import the
proprietary `framer` runtime (`addPropertyControls`, `withCSS`, `motion`,
`useIsStaticRenderer`) for editor metadata only.

Decision: **do not add the `framer` package.** Property controls, CSS-mask icon
wrappers and static-renderer hooks are Framer-editor concerns; PIVOT gets none
of them. Geometry is reused verbatim, the canvas algorithm is preserved, and
colour comes from `currentColor` / PIVOT tokens. Zero new dependencies.

Adaptations (section 3):
- Line field is always transparent (the workspace paints `--color-paper`); the
  original's painted vignette required an opaque background, so edge falloff is
  a CSS mask instead (`.lines-veil` in `index.css`) — it clears the reading
  column and keeps the strongest lines in the margins.
- Container is `pointer-events-none`; pointer tracking listens on `window` and
  maps into container space, so the field can never swallow clicks.
- `prefers-reduced-motion` renders one static centred frame (no rAF loop);
  the loop also pauses off-screen and on hidden tabs (`IntersectionObserver` +
  `visibilitychange`), and DPR is capped at 2.
- Mobile uses the orbiting mode (touch-follow would fight scrolling).
- Defaults retuned for ink/paper: `rgba(29,29,27,0.16)` strokes, 6–26 lines
  instead of up to 45.
- Glyphs: `aria-hidden`, no interaction; used once as an ornament cluster in
  the empty-state hero (`lg`+ only — hidden below so it never crowds content).

Placement: line field as a `z-0` layer inside `<main>` (scroll surface is
`relative z-10`); glyphs in `EmptyState` only, so they disappear once work
starts.

Also fixed while reviewing this pass: the header centre printed a dangling `/`
separator when `state_version` was 0 — the version and its separator now render
together, only above version 0.
