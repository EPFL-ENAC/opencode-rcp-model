# opencode-rcp-status

An [OpenCode](https://opencode.ai) TUI plugin for **EPFL RCP AIaaS** chat models. It adds:

- a **sidebar widget** — favorites first with readiness ●/○, pool (P/B), per-1M cost, an
  active-model marker (▸), and click-to-switch;
- a **`/rcpmodel` command** (alias `/rcp`) — a picker dialog like the native `/models`, plus a
  filter/sort tab bar.

```
┌ RCP models  ↻ ──────────────────────────┐
│ ▸ actif · ● prêt ○ froid · clic = switch │
│ ▸● B Kimi-K2.7-Code          0.48/1.43   │
│  ○ B Kimi-K2.6-int4          0.48/1.44   │
│  ● P Qwen3.6-27B             0.06/0.19   │
│  ○ P GLM-5.2                 0.56/1.67   │
│    P Apertus-70B-Instruct    0.10/0.30   │
└──────────────────────────────────────────┘
```

## Install

Requires opencode ≥ 1.3 and an EPFL RCP inference key.

1. Clone this repo somewhere stable and install its dependencies:
   ```sh
   git clone https://github.com/EPFL-ENAC/opencode-rcp-status.git
   cd opencode-rcp-status && bun install
   ```
2. Register it in `~/.config/opencode/tui.json` (create the file if needed):
   ```json
   { "plugin": ["/absolute/path/to/opencode-rcp-status"] }
   ```
3. Export your key in the shell that launches opencode:
   ```sh
   export EPFL_RCP_API_KEY="sk-..."
   ```
4. For one-click switching, add the models you switch between to opencode's own favorites via the
   native picker (`/models`, then favorite them). See *Click-to-switch* below.

Restart opencode. The sidebar appears automatically; type `/rcpmodel` to open the picker.

## `/rcpmodel` dialog

Two clickable tab rows sit above the list; the active tab is highlighted:

- **filtre** — `tous` · `favoris` · `prêts` (probed-warm favorites) · `gratuits` (pool basic) ·
  `premium`. Also cycled with **← / →**.
- **tri** — `favoris` (pinned first) · `prix ↑` · `prix ↓` · `nom`. Also cycled with **tab**
  (shift+tab backwards).
- Typing still fuzzy-filters on top of the active filter; ↑/↓/Enter behave as in `/models`.

An empty filter never dead-ends: a placeholder row keeps the tab bar reachable. When the catalog
can't be fetched, the dialog shows the error with an Enter-to-retry row instead of a silent
"No results found".

## Click-to-switch: how it works (and its limits)

The plugin API has no direct model setter, and `client.session.prompt({ model })` is overridden by
the TUI's locally-owned active model. But `command.trigger("model.cycle_favorite")` runs the same
internal command as the native favorite-cycle keybind — which *does* set the active model and
persists it to `<state>/model.json` (`recent[0]` = active model). So a switch:

1. reads opencode's favorites from `model.json`;
2. triggers `model.cycle_favorite` repeatedly, checking `recent[0]` after each step;
3. stops when the target is active, then toasts `Modèle → <name>`.

**Limit:** only models present in **opencode's own favorites** are reachable. Clicking a
non-favorite opens the native picker instead (favorite it there once, then switching works). Keep
`FAVORITES` in `src/config.ts` in sync with your opencode favorites for one-click switching.

## Readiness ●/○

Live ready/down is only exposed by the SSO+Cloudflare portal API (not key-accessible), so favorites
are probed with a 1-token `/v1/chat/completions` call (5 s timeout) on open and when clicking `↻`.
Probing a cold favorite nudges it to load. A key-authenticated status endpoint has been requested
from the RCP team; when it lands, swap `probeModel()` in `src/catalog.ts` for a read of that
endpoint.

## On-/off-VPN behaviour

- **On VPN**, the rich internal endpoint `/v1/model/info` provides cost and pool.
- **Off VPN**, that host is unreachable, so the plugin falls back to the external host's id-only
  `/v1/models`. The full list and switching still work, but without cost/pool (note
  `hors VPN : pas de coût/pool`; the gratuits/premium filters and price sorts are empty then).
  Readiness probes use the external host, so ●/○ works on and off VPN.

## Project layout

```
tui.tsx            entry point: wires state + sidebar slot + /rcpmodel command
src/
  config.ts        endpoints, timeouts, FAVORITES, tuning (env-overridable)
  types.ts         shared types incl. the RcpApi surface this plugin relies on
  util.ts          small pure helpers
  catalog.ts       fetch + normalise the model catalog; readiness probe
  switching.ts     model.json access + favorite-cycle switching machinery
  state.ts         reactive state shared by the sidebar and the dialog
  filters.ts       filter/sort definitions for the dialog
  dialog.tsx       the /rcpmodel picker (tab bar + DialogSelect)
  sidebar.tsx      the sidebar widget
```

Verify changes with `bun run typecheck` and `bun run build`.

## Customize (`src/config.ts`)

- `FAVORITES` — pinned, probed, and switchable models.
- `config.maxOthers` — how many extra chat models the sidebar lists.
- `config.refreshMs` — catalog poll interval (metadata is static, so 60 s).
- `config.truncWidth` — sidebar name width.
- Env overrides: `RCP_INFER_HOST`, `RCP_INFER_EXT_HOST`, `RCP_MODELINFO_URL`, `EPFL_RCP_API_KEY`.

## How it works (TUI internals)

Rendered into opencode's `sidebar_content` slot via `@opencode-ai/plugin/tui` (OpenTUI + SolidJS).
opencode aliases the plugin's `@opentui/solid` / `solid-js` imports to its own instances, so the
plugin shares the host's Solid runtime and renderer context — reactive props cross the boundary and
host hooks like `useKeyboard` work directly. The dialog wires its filter/sort keys both through
`DialogSelect`'s native `keybind` prop and a fallback `useKeyboard` hook, and remounts
`DialogSelect` (keyed `<Show>`) on mode change because its internal selected index is not clamped
when the option list shrinks.

## Roadmap

### Live status endpoint
Readiness is currently a latency probe (see above). A key-authenticated status endpoint has been
requested from the RCP team; once it ships, `probeModel()` in `src/catalog.ts` can be swapped for a
plain read of that endpoint, giving true three-state status (down / loading / ready) for *all*
models instead of only the probed favorites.

### Optional v2 (Effect) catalog plugin
opencode's newer plugin API (v2, `@opencode-ai/plugin/dist/v2`) adds server-side **Effect** hooks,
including a `catalog` hook that can inject and enrich the model catalog (`draft.model.update(...)`,
`draft.model.default.set(...)`) and re-run itself with `catalog.reload()`. A small v2 plugin could:

- auto-populate the native catalog with RCP models + cost/pool from `/v1/model/info` (replacing a
  hand-maintained `opencode.json` / sync script), and
- refresh it via `reload()` when the RCP status endpoint updates.

**Not adopted here**, and deliberately so:

- v2 is **server-side only** — it has no TUI context, so it can render neither the sidebar widget
  nor the `/rcpmodel` dialog. It would complement, not replace, this v1 TUI plugin.
- It requires a much newer opencode binary: the v2 loader (`readV2Plugin`, `PluginContext`, the
  `effect` runtime) is absent from older builds (e.g. 1.3.x ships only `readV1Plugin`).
- It does **not** expose an active-model setter, so it wouldn't remove the favorite-cycle switching
  workaround either.

The natural time to revisit is once opencode is upgraded to a v2-capable build *and* the RCP status
endpoint lands: a v2 `catalog` plugin would own catalog enrichment while this v1 plugin keeps the
interactive widget/dialog. The two plugin kinds coexist without conflict.

## Credit

Built by [ENAC-IT4R](https://www.epfl.ch/schools/enac/) at EPFL. MIT licensed.
