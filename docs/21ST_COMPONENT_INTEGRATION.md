# 21st.dev Component Integration Rules (PIVOT)

Preparation note. No 21st.dev components have been provided yet — do not invent
any. When component code, links, or snippets arrive, follow this process.

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
