# opencode-rcp-model

An [OpenCode](https://opencode.ai) TUI plugin for **EPFL RCP AIaaS** chat models. It adds:

- a **sidebar widget** — favorites first with live status ●/◐/○, a 24/7 marker (∞), pool (P/B),
  per-1M cost, an active-model marker (▸), and click-to-switch; the remaining models follow,
  ready ones first (most of the ~280-model catalog is scaled to zero at any moment);
- a **`/rcpmodel` command** (alias `/rcp`) — a picker dialog like the native `/models`, plus a
  filter/sort tab bar.

```
┌ RCP models  ↻ ─────────────────────────────┐
│ ▸ actif · ● prêt ◐ charge ○ arrêt ∞ 24/7   │
│ ▸●  B Kimi-K2.7-Code          0.48/1.43    │
│  ◐  B Kimi-K2.6-int4          0.48/1.44    │
│  ●∞ P Qwen3.6-27B             0.06/0.19    │
│  ○  P GLM-5.2                 0.56/1.67    │
│  ○  P Apertus-70B-Instruct    0.10/0.30    │
└────────────────────────────────────────────┘
```

## Install

Requires opencode ≥ 1.3 and an EPFL RCP inference key. Live status additionally needs RCP portal
≥ 1.8.2, which introduced the key-authenticated `models-status` endpoint; against an older portal
the catalog, cost and switching still work and every row simply shows `·`.

1. Clone this repo somewhere stable and install its dependencies:
   ```sh
   git clone https://github.com/EPFL-ENAC/opencode-rcp-model.git
   cd opencode-rcp-model && bun install
   ```
2. Register it in `~/.config/opencode/tui.json` (create the file if needed):
   ```json
   { "plugin": ["/absolute/path/to/opencode-rcp-model"] }
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

- **filtre** — `tous` · `favoris` · `prêts` (status `ready`) · `24/7` (always-up models) ·
  `gratuits` (pool basic) · `premium`. Also cycled with **← / →**.
- **tri** — `favoris` (pinned first) · `prix ↑` · `prix ↓` · `nom`. Also cycled with **tab**
  (shift+tab backwards).
- Typing still fuzzy-filters on top of the active filter; ↑/↓/Enter behave as in `/models`.

An empty filter never dead-ends: a placeholder row keeps the tab bar reachable. When the catalog
can't be fetched, the dialog shows the error with an Enter-to-retry row instead of a silent
"No results found".

## `/rcpsync` — declaring the catalog in opencode.json

opencode can only select models its config declares, so the ~280-model catalog is invisible to it
until `opencode.json` lists them. `/rcpsync` (command palette: *RCP: sync opencode.json*) reads
`/v1/model/info` and writes every chat model into the `epfl-rcp` provider block with its current
cost and context limits.

The merge is deliberately conservative:

- entries you already curated keep their hand-written `name`; only `cost` and `limit` are refreshed;
- models present in your config but absent from the catalog are **never removed**;
- embeddings and rerankers (`mode` other than `completion`) are skipped;
- the file is backed up and then written atomically (temp + rename), so an interrupted write cannot
  truncate your config. The first run writes `opencode.json.bak`; later runs never overwrite it and
  write a timestamped copy instead, so the pre-sync original always stays recoverable.

opencode reads its config at startup, so **restart it** afterwards. The toast reports how many models
were added and updated, and where the backup went.

## Click-to-switch: how it works (and its limits)

The plugin API has no direct model setter, and `client.session.prompt({ model })` is overridden by
the TUI's locally-owned active model. But `command.trigger("model.cycle_favorite")` runs the same
internal command as the native favorite-cycle keybind — which *does* set the active model and
persists it to `<state>/model.json` (`recent[0]` = active model). So a switch:

1. reads opencode's favorites from `model.json`;
2. triggers `model.cycle_favorite` repeatedly, checking `recent[0]` after each step;
3. stops when the target is active, then toasts `Modèle → <name>`.

opencode exposes exactly two cyclable rings — `model.cycle_favorite` and `model.cycle_recent` — and
the plugin uses whichever one contains the target, so **favorites ∪ recent** is the set a click can
reach. Everything else opens the native picker; choosing it there once puts it in `recent`, and from
then on the click works.

**Growing the rings from the plugin is not possible.** opencode keeps both lists in memory and
rewrites `model.json` from its own copy, so appending a favorite there is silently discarded — the
file is opencode's output, not its input. There is no favorite-toggle or state-reload command in the
TUI command registry either (the complete model surface is `model.list` plus the four
`cycle_favorite`/`cycle_recent` variants), and the plugin API has no active-model setter. Favorite
the models you use often through the native picker, and the ring stays useful.

**The real limit is opencode's config, not favorites.** A model that `opencode.json` does not declare
under the `epfl-rcp` provider cannot be selected at all — the cycler skips it and no favorite helps.
The plugin detects this case up front and says `n'est pas déclaré dans opencode.json` rather than
blaming favorites. The sidebar lists everything the RCP catalog offers (~280 models), so expect most
of them to need a config entry before they are selectable.

## Statut en direct ●/◐/○/✗

Status comes from the portal's key-authenticated endpoint (RCP portal ≥ 1.8.2):

```sh
curl -H "Authorization: Bearer $EPFL_RCP_API_KEY" \
  https://portal.rcp.epfl.ch/aiaas/api/v1/models-status
# [{ "model_name": "openai/gpt-oss-120b", "status": "down", "is_always_up": true }, …]
```

It returns only the models your key can reach, and the portal refreshes it from Prometheus every
~15 s, so the plugin polls it every 20 s (`config.statusRefreshMs`) — independently of the 60 s
catalog poll.

| glyph | status | meaning |
| --- | --- | --- |
| `●` | `ready` | loaded, answers immediately |
| `◐` | `loading` | starting up |
| `○` | `down` | scaled to zero |
| `✗` | `error` | the model is in an error state |
| `·` | — | unknown: not in the payload, or the endpoint is unreachable |

`∞` marks `is_always_up` models — the ones RCP pins 24/7 rather than autoscaling to zero, so they are
the models that normally answer without a cold start. It is a property of the deployment, not a
live state: an always-up model can still report `down` (during maintenance, for instance), so the
glyph column is the authoritative answer to "can I use it right now", and `∞` to "will it still be
warm tomorrow".

**Nothing here wakes a model.** Earlier versions inferred readiness by sending a 1-token
`/v1/chat/completions` probe, which itself made a cold model start loading; that probe is gone
(requested as [INC0810453](https://portal.rcp.epfl.ch/core/releasenotes), shipped by the RCP team in
portal 1.8.2). If the endpoint fails, one failed poll keeps the last known statuses; after two, every
row falls back to `·` and the reason is shown in the sidebar and the dialog placeholder.

## On-/off-VPN behaviour

- **On VPN**, the rich internal endpoint `/v1/model/info` provides cost and pool.
- **Off VPN**, that host is unreachable, so the plugin falls back to the external host's id-only
  `/v1/models`. The full list and switching still work, but without cost/pool (note
  `hors VPN : pas de coût/pool`; the gratuits/premium filters and price sorts are empty then).
- The **status** endpoint lives on the portal host, which is independent of the two inference hosts.

## Project layout

```
tui.tsx            entry point: wires state + sidebar slot + /rcpmodel command
src/
  config.ts        endpoints, timeouts, FAVORITES, tuning (env-overridable)
  types.ts         shared types incl. the RcpApi surface this plugin relies on
  util.ts          small pure helpers
  catalog.ts       fetch + normalise the model catalog (cost, pool, favorites)
  status.ts        live per-model status from the portal (read-only, never wakes a model)
  sync.ts          /rcpsync: declare the catalog in opencode.json (backup + atomic write)
  switching.ts     model.json access + favorite-cycle switching machinery
  state.ts         reactive state shared by the sidebar and the dialog
  filters.ts       filter/sort definitions for the dialog
  dialog.tsx       the /rcpmodel picker (tab bar + DialogSelect)
  sidebar.tsx      the sidebar widget
```

Verify changes with `bun run typecheck` and `bun run build`.

## Customize (`src/config.ts`)

- `FAVORITES` — pinned and switchable models.
- `config.maxOthers` — how many extra chat models the sidebar lists.
- `config.refreshMs` — catalog poll interval (metadata is static, so 60 s).
- `config.statusRefreshMs` — status poll interval (20 s; the portal itself refreshes every ~15 s).
- `config.truncWidth` — sidebar name width.
- Env overrides: `EPFL_RCP_API_KEY`, `RCP_INFER_HOST`, `RCP_INFER_EXT_HOST`, `RCP_MODELINFO_URL`,
  `RCP_PORTAL_HOST`, `RCP_STATUS_URL`.

## How it works (TUI internals)

Rendered into opencode's `sidebar_content` slot via `@opencode-ai/plugin/tui` (OpenTUI + SolidJS).
opencode aliases the plugin's `@opentui/solid` / `solid-js` imports to its own instances, so the
plugin shares the host's Solid runtime and renderer context — reactive props cross the boundary and
host hooks like `useKeyboard` work directly. The dialog wires its filter/sort keys both through
`DialogSelect`'s native `keybind` prop and a fallback `useKeyboard` hook, and remounts
`DialogSelect` (keyed `<Show>`) on mode change because its internal selected index is not clamped
when the option list shrinks.

## Roadmap

### Optional v2 (Effect) catalog plugin
opencode's newer plugin API (v2, `@opencode-ai/plugin/dist/v2`) adds server-side **Effect** hooks,
including a `catalog` hook that can inject and enrich the model catalog (`draft.model.update(...)`,
`draft.model.default.set(...)`) and re-run itself with `catalog.reload()`. A small v2 plugin could:

- auto-populate the native catalog with RCP models + cost/pool from `/v1/model/info` (replacing a
  hand-maintained `opencode.json` / sync script), and
- refresh it via `reload()` when the models-status payload changes.

**Not adopted here**, and deliberately so:

- v2 is **server-side only** — it has no TUI context, so it can render neither the sidebar widget
  nor the `/rcpmodel` dialog. It would complement, not replace, this v1 TUI plugin.
- It requires a much newer opencode binary: the v2 loader (`readV2Plugin`, `PluginContext`, the
  `effect` runtime) is absent from older builds (e.g. 1.3.x ships only `readV1Plugin`).
- It does **not** expose an active-model setter, so it wouldn't remove the favorite-cycle switching
  workaround either.

The natural time to revisit is once opencode is upgraded to a v2-capable build: a v2 `catalog` plugin
would own catalog enrichment while this v1 plugin keeps the interactive widget/dialog. The two plugin
kinds coexist without conflict.

## Credit

Built by [ENAC-IT4R](https://www.epfl.ch/schools/enac/) at EPFL. MIT licensed.
