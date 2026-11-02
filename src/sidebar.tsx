/** @jsxImportSource @opentui/solid */
// The sidebar widget: favorites first with readiness ●/○, pool, cost, an active
// marker, and click-to-switch; then a capped list of the remaining chat models.

import { TextAttributes } from "@opentui/core"
import { createMemo, For, onMount, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/tui"
import { config } from "./config"
import { ellipsize, isFavorite } from "./catalog"
import type { Pool, Readiness, Row } from "./types"
import type { RcpState } from "./state"

const POOL_BADGE: Record<Pool, string> = { basic: "B", premium: "P", unknown: " " }

const readinessDot = (readiness: Readiness | undefined): string =>
  readiness === "warm" ? "●" : readiness === "cold" ? "○" : readiness === "checking" ? "·" : " "

export function Sidebar(props: { state: RcpState }) {
  const context = usePlugin()
  const state = props.state
  const theme = () => context.theme

  onMount(() => {
    void state.loadCatalog()
    void state.probeFavorites() // probe once on open; refresh via the ↻ header
  })

  const favorites = createMemo(() => state.rows().filter(isFavorite))
  const others = createMemo(() => state.rows().filter((row) => !isFavorite(row)))
  const shownOthers = createMemo(() => others().slice(0, config.maxOthers))
  const hiddenCount = createMemo(() => Math.max(0, others().length - config.maxOthers))

  const marker = (name: string): string =>
    state.switching() === name ? "⇄" : state.current() === name ? "▸" : " "

  const rowText = (row: Row, dot: string): string =>
    `${marker(row.name)}${dot} ${POOL_BADGE[row.pool]} ${ellipsize(row.short).padEnd(config.truncWidth)}${(row.cost || "").padStart(9)}`

  const favoriteColor = (row: Row) => {
    if (state.current() === row.name) return theme().hue.accent[500]
    return state.readiness()[row.name] === "warm" ? theme().text.base : theme().text.muted
  }

  return (
    <box>
      <text fg={theme().text.base} attributes={TextAttributes.BOLD} onMouseDown={() => void state.probeFavorites()}>
        RCP models  ↻
      </text>
      <Show when={state.note()} fallback={<text fg={theme().text.muted}>▸ actif · ● prêt ○ froid · clic = switch</text>}>
        <text fg={theme().text.muted}>{state.note()}</text>
      </Show>
      <For each={favorites()}>
        {(row) => (
          <text
            fg={favoriteColor(row)}
            attributes={state.current() === row.name ? TextAttributes.BOLD : undefined}
            onMouseDown={() => void state.switchTo(row.name)}
          >
            {rowText(row, readinessDot(state.readiness()[row.name]))}
          </text>
        )}
      </For>
      <For each={shownOthers()}>
        {(row) => (
          <text fg={theme().text.base} onMouseDown={() => void state.switchTo(row.name)}>
            {rowText(row, " ")}
          </text>
        )}
      </For>
      <Show when={hiddenCount() > 0}>
        <text fg={theme().text.muted}>{`  … +${hiddenCount()} more`}</text>
      </Show>
    </box>
  )
}
