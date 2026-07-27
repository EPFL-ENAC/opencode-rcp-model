/** @jsxImportSource @opentui/solid */
// The sidebar widget: favorites first with live status ●/◐/○, a 24/7 marker,
// pool, cost, an active marker, and click-to-switch; then a capped list of the
// remaining chat models.

import { createMemo, For, onMount, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { config } from "./config"
import { ellipsize, isFavorite } from "./catalog"
import type { Pool, RcpApi, Readiness, Row } from "./types"
import type { RcpState } from "./state"

const POOL_BADGE: Record<Pool, string> = { basic: "B", premium: "P", unknown: " " }

const STATUS_DOT: Record<Readiness, string> = {
  ready: "●",
  loading: "◐",
  down: "○",
  error: "✗",
  unknown: "·",
}

/** Sidebar ordering for non-favorites: usable models first. */
const STATUS_ORDER: Record<Readiness, number> = { ready: 0, loading: 1, error: 2, down: 3, unknown: 4 }

export function Sidebar(props: { api: RcpApi; state: RcpState }) {
  const state = props.state
  const theme = () => props.api.theme.current

  const refresh = () => {
    void state.loadCatalog()
    void state.loadStatuses()
  }

  onMount(refresh) // then on the plugin's own timers, or on the ↻ header

  const favorites = createMemo(() => state.rows().filter(isFavorite))

  // Most of the catalog is scaled to zero at any given time, and only maxOthers
  // rows fit, so surface the ready ones instead of the alphabetically first.
  // filter() copies, so the in-place sort leaves the shared rows untouched, and
  // a stable sort keeps the catalog's name order within each status group.
  const others = createMemo(() =>
    state
      .rows()
      .filter((row) => !isFavorite(row))
      .sort((a, b) => STATUS_ORDER[a.readiness ?? "unknown"] - STATUS_ORDER[b.readiness ?? "unknown"]),
  )
  const shownOthers = createMemo(() => others().slice(0, config.maxOthers))
  const hiddenCount = createMemo(() => Math.max(0, others().length - config.maxOthers))

  const marker = (name: string): string =>
    state.switching() === name ? "⇄" : state.current() === name ? "▸" : " "

  const rowText = (row: Row): string =>
    `${marker(row.name)}${STATUS_DOT[row.readiness ?? "unknown"]}${row.isAlwaysUp ? "∞" : " "} ${POOL_BADGE[row.pool]} ${ellipsize(row.short).padEnd(config.truncWidth)}${(row.cost || "").padStart(9)}`

  const rowColor = (row: Row): string => {
    if (state.current() === row.name) return theme().accent
    if (row.readiness === "ready") return theme().text
    if (row.readiness === "loading") return theme().warning ?? theme().textMuted
    if (row.readiness === "error") return theme().error ?? theme().textMuted
    return theme().textMuted
  }

  const modelRow = (row: Row) => (
    <text
      fg={rowColor(row)}
      attributes={state.current() === row.name ? TextAttributes.BOLD : undefined}
      onMouseDown={() => void state.switchTo(row.name)}
    >
      {rowText(row)}
    </text>
  )

  return (
    <box>
      <text fg={theme().text} attributes={TextAttributes.BOLD} onMouseDown={refresh}>
        RCP models  ↻
      </text>
      <Show
        when={state.note() || state.statusNote()}
        fallback={<text fg={theme().textMuted}>▸ actif · ● prêt ◐ charge ○ arrêt ∞ 24/7</text>}
      >
        <text fg={theme().textMuted}>{state.note() || state.statusNote()}</text>
      </Show>
      <For each={favorites()}>{modelRow}</For>
      <For each={shownOthers()}>{modelRow}</For>
      <Show when={hiddenCount() > 0}>
        <text fg={theme().textMuted}>{`  … +${hiddenCount()} more`}</text>
      </Show>
    </box>
  )
}
