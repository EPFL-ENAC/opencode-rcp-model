/** @jsxImportSource @opentui/solid */
// The /rcpmodel picker: same UX as the native /models dialog, plus a filter/sort
// tab bar. Left/right cycles the filter, tab cycles the sort, and both bars are
// also clickable; typing still fuzzy-filters on top.

import { createMemo, createSignal, For, Show } from "solid-js"
import type { Accessor, JSX } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { config } from "./config"
import { isFavorite } from "./catalog"
import { cyclableFavorites } from "./switching"
import { FILTERS, SORTS } from "./filters"
import type { RcpApi, Readiness, Row } from "./types"
import type { RcpState } from "./state"

// Sentinel option values (no real model id contains these).
const RETRY = "__retry"
const EMPTY = "__none"

const readinessLabel = (readiness: Readiness | undefined): string =>
  readiness === "warm" ? "● prêt" : readiness === "cold" ? "○ froid" : readiness === "checking" ? "· test…" : ""

type Theme = () => Record<string, string>

/** A clickable row of choices; the active one is highlighted. */
function TabBar(props: {
  label: string
  items: string[]
  active: Accessor<number>
  onPick: (index: number) => void
  theme: Theme
}) {
  return (
    <box flexDirection="row" gap={1} paddingLeft={4} paddingRight={4}>
      <text fg={props.theme().textMuted}>{props.label}</text>
      <For each={props.items}>
        {(item, index) => (
          <text
            fg={index() === props.active() ? props.theme().accent : props.theme().textMuted}
            attributes={index() === props.active() ? TextAttributes.BOLD : undefined}
            onMouseDown={() => props.onPick(index())}
          >
            {item}
          </text>
        )}
      </For>
    </box>
  )
}

/** Build the " · "-separated metadata line shown under each model. */
function describeRow(row: Row, state: RcpState, switchable: Set<string>): string {
  return [
    row.pool === "unknown" ? "" : row.pool,
    row.cost ? `${row.cost} CHF/1M` : "",
    isFavorite(row) ? readinessLabel(state.readiness()[row.name]) : "",
    row.name === state.current() ? "actif" : "",
    switchable.has(row.name) ? "" : "→ picker natif",
  ]
    .filter(Boolean)
    .join(" · ")
}

export function RcpDialog(props: { api: RcpApi; state: RcpState }) {
  const state = props.state
  const theme: Theme = () => props.api.theme.current
  const [filterIndex, setFilterIndex] = createSignal(0)
  const [sortIndex, setSortIndex] = createSignal(0)

  // Defer index changes made from key handlers: a synchronous signal write would
  // dispose the keyed DialogSelect (below) while key dispatch is still walking it.
  const cycle = (setter: typeof setFilterIndex, length: number, dir: number) =>
    queueMicrotask(() => setter((i) => (i + dir + length) % length))
  const cycleFilter = (dir: number) => cycle(setFilterIndex, FILTERS.length, dir)
  const cycleSort = (dir: number) => cycle(setSortIndex, SORTS.length, dir)

  // Keys are wired two ways: DialogSelect's own `keybind` prop (renders the footer
  // hints, but only fires while an option is selected) and this global hook as a
  // fallback. The hook skips events already handled (defaultPrevented) to dedup.
  const keybind = (name: string) => ({ name, ctrl: false, meta: false, shift: false, super: false, leader: false })
  const keybinds = [
    { title: "◂", keybind: keybind("left"), onTrigger: () => cycleFilter(-1) },
    { title: "▸", keybind: keybind("right"), onTrigger: () => cycleFilter(1) },
    { title: "tri", keybind: keybind("tab"), onTrigger: () => cycleSort(1) },
  ]
  useKeyboard((evt: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; defaultPrevented?: boolean; preventDefault?: () => void; stopPropagation?: () => void }) => {
    if (evt.defaultPrevented || evt.ctrl || evt.meta) return
    if (evt.name === "left" && !evt.shift) cycleFilter(-1)
    else if (evt.name === "right" && !evt.shift) cycleFilter(1)
    else if (evt.name === "tab") cycleSort(evt.shift ? -1 : 1)
    else return
    evt.preventDefault?.()
    evt.stopPropagation?.()
  })

  const options = createMemo(() => {
    // Surface a fetch error instead of a silent "No results found".
    if (!state.rows().length) {
      return [{ title: `⚠ ${state.note() || "chargement…"}`, value: RETRY, description: "Entrée pour réessayer", category: "RCP" }]
    }

    const filter = FILTERS[filterIndex()]
    const sort = SORTS[sortIndex()]
    const matching = state.rows().filter((row) => filter.match(row, state.readiness()))
    const sorted = [...matching].sort(sort.compare)

    // Never return an empty list: a placeholder keeps the tab bar reachable.
    if (!sorted.length) {
      return [{ title: `(${filter.empty})`, value: EMPTY, description: "◂ ▸ pour changer de filtre", category: filter.label }]
    }

    const isDefaultView = filterIndex() === 0 && sortIndex() === 0
    const switchable = new Set(
      cyclableFavorites(props.api)
        .filter((ref) => ref.providerID === config.providerId)
        .map((ref) => ref.modelID),
    )
    return sorted.map((row) => ({
      title: row.short,
      value: row.name,
      description: describeRow(row, state, switchable),
      category: isDefaultView ? (isFavorite(row) ? "Favoris" : "Autres modèles") : `${filter.label} · tri: ${sort.label}`,
    }))
  })

  const onSelect = (option: { value: string }) => {
    if (option.value === EMPTY) return
    if (option.value === RETRY) return void state.loadCatalog()
    props.api.ui.dialog.clear()
    void state.switchTo(option.value)
  }

  const DialogSelect = props.api.ui.DialogSelect as (props: Record<string, unknown>) => JSX.Element
  return (
    <box>
      <TabBar label="filtre" items={FILTERS.map((f) => f.label)} active={filterIndex} onPick={setFilterIndex} theme={theme} />
      <TabBar label="tri   " items={SORTS.map((s) => s.label)} active={sortIndex} onPick={setSortIndex} theme={theme} />
      {/* Keyed so DialogSelect remounts on mode change: its internal selected
          index is not clamped when the option list shrinks. */}
      <Show when={`${filterIndex()}|${sortIndex()}`} keyed>
        {(_mode) => (
          <DialogSelect
            title="RCP models"
            keybind={keybinds}
            placeholder={state.note() ? `⚠ ${state.note()}` : "Filtrer… (◂ ▸ filtre · ⇥ tri · clic sur les onglets)"}
            current={state.current()}
            options={options()}
            onSelect={onSelect}
          />
        )}
      </Show>
    </box>
  )
}
