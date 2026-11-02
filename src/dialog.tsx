/** @jsxImportSource @opentui/solid */
// The /rcpmodel picker: same UX as the native /models dialog, plus a filter/sort
// tab bar. Left/right cycles the filter, tab cycles the sort, and both bars are
// also clickable; typing still fuzzy-filters on top.
//
// V2 no longer exposes a host DialogSelect component to plugins, so this picker
// is built from OpenTUI primitives following the host's own select dialog: a
// focused input, a scrollbox list with category headers, and a keymap layer
// that reuses the built-in `dialog.select.*` commands so user keybinds apply.

import { CliRenderEvents, InputRenderable, ScrollBoxRenderable, TextAttributes, type Renderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import * as fuzzysort from "fuzzysort"
import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/tui"
import { config } from "./config"
import { isFavorite } from "./catalog"
import { cyclableFavorites } from "./switching"
import { FILTERS, SORTS } from "./filters"
import type { PluginContext, Readiness, Row } from "./types"
import type { RcpState } from "./state"

// Same insets as the host's dialogs (3-cell padding, list one cell deeper).
const DIALOG_INSET = 3
const DIALOG_LIST_INSET = DIALOG_INSET + 1

const readinessLabel = (readiness: Readiness | undefined): string =>
  readiness === "warm" ? "● prêt" : readiness === "cold" ? "○ froid" : readiness === "checking" ? "· test…" : ""

type Theme = PluginContext["theme"]

/** A clickable row of choices; the active one is highlighted. */
function TabBar(props: {
  label: string
  items: string[]
  active: () => number
  onPick: (index: number) => unknown
  theme: () => Theme
}) {
  return (
    <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
      <text fg={props.theme().text.muted}>{props.label}</text>
      <For each={props.items}>
        {(item, index) => (
          <text
            fg={index() === props.active() ? props.theme().hue.accent[500] : props.theme().text.muted}
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

type Option = {
  row: Row
  title: string
  value: string
  description: string
  category: string
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

export function RcpDialog(props: { state: RcpState }) {
  const context = usePlugin()
  const state = props.state
  const theme = () => context.theme.surface("dialog")
  const renderer = context.renderer
  const dimensions = useTerminalDimensions()

  const [filterIndex, setFilterIndex] = createSignal(0)
  const [sortIndex, setSortIndex] = createSignal(0)
  const [query, setQuery] = createSignal("")
  const [selected, setSelected] = createSignal(0)

  const cycleFilter = (dir: number): void => {
    setFilterIndex((i) => (i + dir + FILTERS.length) % FILTERS.length)
  }
  const cycleSort = (dir: number): void => {
    setSortIndex((i) => (i + dir + SORTS.length) % SORTS.length)
  }

  const options = createMemo<Option[]>(() => {
    if (!state.rows().length) return []

    const filter = FILTERS[filterIndex()]
    const sort = SORTS[sortIndex()]
    const matching = state.rows().filter((row) => filter.match(row, state.readiness()))
    const sorted = [...matching].sort(sort.compare)

    const isDefaultView = filterIndex() === 0 && sortIndex() === 0
    const switchable = new Set(
      cyclableFavorites(context)
        .filter((ref) => ref.providerID === config.providerId)
        .map((ref) => ref.modelID),
    )
    return sorted.map((row) => ({
      row,
      title: row.short,
      value: row.name,
      description: describeRow(row, state, switchable),
      category: isDefaultView ? (isFavorite(row) ? "Favoris" : "Autres modèles") : `${filter.label} · tri: ${sort.label}`,
    }))
  })

  // Fuzzy filter, like the native picker: title matches weigh double over category.
  const filtered = createMemo<Option[]>(() => {
    const list = options()
    const needle = query().trim().toLowerCase()
    if (!needle) return list
    return fuzzysort
      .go(needle, list, { keys: ["title", "category"], scoreFn: (r) => r[0].score * 2 + r[1].score })
      .map((result) => result.obj)
  })

  // Group consecutive same-category options so a header can be drawn between groups.
  const grouped = createMemo<Array<[string, Option[]]>>(() => {
    const groups: Array<[string, Option[]]> = []
    for (const option of filtered()) {
      const last = groups[groups.length - 1]
      if (last && last[0] === option.category) last[1].push(option)
      else groups.push([option.category, [option]])
    }
    return groups
  })

  const flat = createMemo<Option[]>(() => grouped().flatMap(([, options]) => options))
  const mode = () => `${filterIndex()}|${sortIndex()}`

  // Re-focus after a deliberate reshape (typing, filter/sort change): the typed
  // query starts at its first row, otherwise on the active model. A background
  // catalog refresh only keeps the highlighted option when it still exists.
  createEffect(
    on([query, mode, flat], ([value, currentMode, list], previous) => {
      if (!list.length) return
      const refocus = previous === undefined || value !== previous[0] || currentMode !== previous[1]
      const keep = refocus ? undefined : previous[2][selected()]
      if (!refocus && keep !== undefined) {
        const index = list.findIndex((option) => option.value === keep.value)
        if (index >= 0) return setSelected(index)
      }
      if (value) return setSelected(0)
      const current = state.current()
      const index = current ? list.findIndex((option) => option.value === current) : -1
      setSelected(index >= 0 ? index : 0)
    }),
  )

  // Keep the highlighted row visible through any selection change.
  createEffect(on(selected, () => scrollToSelection()))

  // --- scroll the selection into view (one frame later, once layout has run) --

  let scroll: ScrollBoxRenderable | undefined
  let pendingScroll: (() => void) | undefined

  function rowRenderable(): Renderable | undefined {
    if (!scroll) return undefined
    // Locate the row by position because a unique renderable ID cannot currently be ensured.
    let index = 0
    let remaining = selected()
    for (const [category, options] of grouped()) {
      if (category) index++
      if (remaining < options.length) {
        index += remaining
        break
      }
      index += options.length
      remaining -= options.length
    }
    return scroll.getChildren()[index]
  }

  function scrollToSelection() {
    if (!scroll) return
    if (pendingScroll) renderer.off(CliRenderEvents.FRAME, pendingScroll)
    pendingScroll = () => {
      pendingScroll = undefined
      const target = rowRenderable()
      if (!target) return
      const y = target.y - scroll!.y
      if (y >= scroll!.height) scroll!.scrollBy(y - scroll!.height + 1)
      if (y < 0) {
        scroll!.scrollBy(y)
        if (selected() === 0) scroll!.scrollTo(0)
      }
    }
    renderer.once(CliRenderEvents.FRAME, pendingScroll)
    renderer.requestRender()
  }

  onCleanup(() => {
    if (!pendingScroll) return
    renderer.off(CliRenderEvents.FRAME, pendingScroll)
    pendingScroll = undefined
  })

  // --- keyboard ---------------------------------------------------------------

  function moveTo(next: number) {
    const count = flat().length
    if (!count) return
    setSelected(((next % count) + count) % count)
  }

  function move(direction: number) {
    moveTo(selected() + direction)
  }

  function submit() {
    const option = flat()[selected()]
    if (option) {
      context.ui.dialog.clear()
      void state.switchTo(option.value)
      return
    }
    // Nothing to select: a fetch error or cold start means Enter retries.
    if (!state.rows().length) void state.loadCatalog()
  }

  // Reuse the built-in dialog navigation commands so user keybinds apply, and
  // add the filter/sort cycling as inline bindings. The layer is scoped to the
  // modal mode and dies with this dialog.
  context.keymap.layer(() => ({
    mode: "modal",
    commands: [
      { id: "dialog.select.prev", title: "Previous item", group: "Dialog", run: () => move(-1) },
      { id: "dialog.select.next", title: "Next item", group: "Dialog", run: () => move(1) },
      { id: "dialog.select.page_up", title: "Page up", group: "Dialog", run: () => move(-10) },
      { id: "dialog.select.page_down", title: "Page down", group: "Dialog", run: () => move(10) },
      { id: "dialog.select.home", title: "First item", group: "Dialog", run: () => moveTo(0) },
      { id: "dialog.select.end", title: "Last item", group: "Dialog", run: () => moveTo(flat().length - 1) },
      { id: "dialog.select.submit", title: "Select item", group: "Dialog", run: submit },
      { id: "rcp.dialog.filter.prev", title: "Previous filter", bind: "left", run: () => cycleFilter(-1) },
      { id: "rcp.dialog.filter.next", title: "Next filter", bind: "right", run: () => cycleFilter(1) },
      { id: "rcp.dialog.sort.next", title: "Next sort", bind: "tab", run: () => cycleSort(1) },
      { id: "rcp.dialog.sort.prev", title: "Previous sort", bind: "shift+tab", run: () => cycleSort(-1) },
    ],
  }))

  // --- view -------------------------------------------------------------------

  onMount(() => {
    void state.probeFavorites()
  })

  let input: InputRenderable | undefined

  const limit = () => Math.floor(dimensions().height / 2) - 6

  return (
    <box paddingLeft={DIALOG_INSET} paddingRight={DIALOG_INSET} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme().text.base}>
          RCP models
        </text>
        <text fg={theme().text.muted}>esc</text>
      </box>
      <TabBar label="filtre" items={FILTERS.map((f) => f.label)} active={filterIndex} onPick={setFilterIndex} theme={theme} />
      <TabBar label="tri   " items={SORTS.map((s) => s.label)} active={sortIndex} onPick={setSortIndex} theme={theme} />
      <input
        flexGrow={1}
        onInput={(value) => setQuery(value)}
        focusedBackgroundColor={theme().background.formfield.focused}
        focusedTextColor={theme().text.formfield.focused}
        cursorColor={theme().text.formfield.focused}
        placeholder={state.note() ? `⚠ ${state.note()}` : "Filtrer… (←/→ filtre · ⇥ tri · clic sur les onglets)"}
        placeholderColor={theme().text.muted}
        ref={(r: InputRenderable) => {
          input = r
          setTimeout(() => {
            if (!input || r.isDestroyed) return
            r.focus()
          }, 1)
        }}
      />
      <Show
        when={grouped().length}
        fallback={
          <Show
            when={state.rows().length}
            fallback={
              <box paddingLeft={DIALOG_LIST_INSET} paddingRight={DIALOG_LIST_INSET} flexDirection="column" gap={1}>
                <text fg={theme().text.muted}>{`⚠ ${state.note() || "chargement…"}`}</text>
                <text fg={theme().text.muted}>↵ pour réessayer</text>
              </box>
            }
          >
            <box paddingLeft={DIALOG_LIST_INSET} paddingRight={DIALOG_LIST_INSET} flexDirection="column" gap={1}>
              <text fg={theme().text.muted}>{`(${FILTERS[filterIndex()].empty})`}</text>
              <text fg={theme().text.muted}>←/→ pour changer de filtre</text>
            </box>
          </Show>
        }
      >
        <scrollbox
          paddingLeft={1}
          paddingRight={1}
          scrollbarOptions={{ visible: false }}
          ref={(r: ScrollBoxRenderable) => {
            scroll = r
          }}
          maxHeight={limit()}
        >
          <For each={grouped()}>
            {([category, options], index) => (
              <>
                <Show when={category}>
                  <box paddingTop={index() === 0 ? 0 : 1} paddingLeft={DIALOG_LIST_INSET - 1}>
                    <text fg={theme().hue.accent[200]} attributes={TextAttributes.BOLD}>
                      {category}
                    </text>
                  </box>
                </Show>
                <For each={options}>
                  {(option) => {
                    const active = createMemo(() => flat()[selected()]?.value === option.value)
                    const current = createMemo(() => option.row.name === state.current())
                    return (
                      <box
                        flexDirection="row"
                        paddingLeft={current() ? DIALOG_LIST_INSET - 3 : DIALOG_LIST_INSET - 1}
                        paddingRight={DIALOG_LIST_INSET - 1}
                        gap={1}
                        backgroundColor={active() ? theme().background.action.primary.focused : undefined}
                        onMouseDown={() => moveTo(flat().indexOf(option))}
                        onMouseUp={() => submit()}
                      >
                        <Show when={current()}>
                          <text flexShrink={0} fg={theme().text.formfield.selected}>
                            ●
                          </text>
                        </Show>
                        <text
                          flexGrow={1}
                          overflow="hidden"
                          wrapMode="none"
                          paddingLeft={3}
                          fg={active() ? theme().text.action.primary.focused : theme().text.base}
                          attributes={active() ? TextAttributes.BOLD : undefined}
                        >
                          {option.title}
                          <Show when={option.description}>
                            <span style={{ fg: active() ? theme().text.action.primary.focused : theme().text.muted }}>
                              {" " + option.description}
                            </span>
                          </Show>
                        </text>
                      </box>
                    )
                  }}
                </For>
              </>
            )}
          </For>
        </scrollbox>
      </Show>
      <box paddingLeft={1}>
        <text fg={theme().text.muted}>↵ basculer · ←/→ filtre · ⇥ tri</text>
      </box>
    </box>
  )
}
