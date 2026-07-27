// Reactive state shared by the sidebar widget and the /rcpmodel dialog.

import { createSignal } from "solid-js"
import { config } from "./config"
import { fetchCatalog, shortName } from "./catalog"
import { fetchStatuses, statusFor } from "./status"
import {
  activeModel,
  cyclableFavorites,
  cyclableRecents,
  isDeclared,
  runCommand,
  sameModel,
  waitForActiveChange,
} from "./switching"
import type { ModelRef, ModelStatus, RcpApi, Row } from "./types"

/** Failed status polls tolerated before the displayed statuses are cleared. */
const STATUS_FAILURES_BEFORE_CLEAR = 2

export function createRcpState(api: RcpApi) {
  const [baseRows, setBaseRows] = createSignal<Row[]>([])
  const [note, setNote] = createSignal("loading…")
  const [statuses, setStatuses] = createSignal<Record<string, ModelStatus>>({})
  const [statusNote, setStatusNote] = createSignal("")
  const [current, setCurrent] = createSignal<string | undefined>(undefined) // active RCP model id
  const [switching, setSwitching] = createSignal<string | undefined>(undefined)

  /**
   * Catalog rows with the live status merged in; the only rows the UI ever sees.
   * A plain derived accessor rather than a memo: this state is built outside any
   * reactive root, where a computation would never be disposed. Consumers all
   * memoize on their own side, and the list is short.
   */
  const rows = (): Row[] => {
    const live = statuses()
    return baseRows().map((row) => {
      const status = statusFor(row.name, live)
      return { ...row, readiness: status?.status ?? "unknown", isAlwaysUp: status?.isAlwaysUp }
    })
  }

  const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info") =>
    api.ui.toast({ message, variant, duration: 3000 })

  /** Resolve the active RCP model id from model.json, falling back to opencode.json. */
  const refreshCurrent = () => {
    const recent = activeModel(api)
    if (recent?.providerID === config.providerId) return setCurrent(recent.modelID)

    const configured = api.state?.config?.model ?? ""
    const prefix = `${config.providerId}/`
    setCurrent(configured.startsWith(prefix) ? configured.slice(prefix.length) : undefined)
  }

  const loadCatalog = async () => {
    const result = await fetchCatalog()
    if (result.ok) {
      setBaseRows(result.rows)
      setNote(result.warning ?? "")
    } else {
      setNote(result.reason)
    }
    refreshCurrent()
  }

  let statusInFlight = false
  let statusFailures = 0
  /**
   * Refresh the live statuses. A single failed poll keeps the last known values
   * (they are at most a few tens of seconds old) so the dots do not flicker; the
   * note appears immediately, and the statuses are dropped once failures persist.
   */
  const loadStatuses = async () => {
    if (statusInFlight) return
    statusInFlight = true
    try {
      const result = await fetchStatuses()
      if (result.ok) {
        statusFailures = 0
        setStatuses(result.statuses)
        setStatusNote("")
      } else {
        statusFailures++
        setStatusNote(result.reason)
        if (statusFailures >= STATUS_FAILURES_BEFORE_CLEAR) setStatuses({})
      }
    } finally {
      statusInFlight = false
    }
  }

  /**
   * Switch the active model by cycling opencode's favorite ring until model.json's
   * recent[0] matches the target. There is no "set active model" call in the plugin
   * API, so the ring is the only lever; a target that is missing from it gets added
   * to opencode's favorites first.
   */
  const switchTo = async (name: string) => {
    if (switching()) return
    if (current() === name) return void toast(`${shortName(name)} déjà actif`)

    const target: ModelRef = { providerID: config.providerId, modelID: name }

    // No favorite trick can help a model opencode's config never declared.
    if (!isDeclared(api, target)) {
      toast(`${shortName(name)} n'est pas déclaré dans opencode.json — ajoute-le à la config`, "error")
      return
    }

    // Two rings can be walked from here. Prefer favorites (short and stable);
    // fall back to the recent ring, which reaches anything used before.
    const favorites = cyclableFavorites(api)
    const recents = cyclableRecents(api)
    const inFavorites = favorites.some((fav) => sameModel(fav, target))
    const inRecents = recents.some((ref) => sameModel(ref, target))

    if (!inFavorites && !inRecents) {
      toast(`${shortName(name)} : choisis-le une fois ici, ensuite le clic suffira`, "warning")
      runCommand(api, "model.list")
      return
    }

    const command = inFavorites ? "model.cycle_favorite" : "model.cycle_recent"
    const ring = inFavorites ? favorites : recents

    setSwitching(name)
    try {
      let previous = activeModel(api)
      // One extra step so we can visit every entry in the ring before giving up.
      for (let step = 0; step <= ring.length; step++) {
        runCommand(api, command)
        const active = await waitForActiveChange(api, previous)
        if (sameModel(active, target)) {
          setCurrent(name)
          return void toast(`Modèle → ${shortName(name)}`, "success")
        }
        previous = active
      }
      toast(`Impossible de basculer sur ${shortName(name)}`, "error")
      runCommand(api, "model.list")
      refreshCurrent()
    } finally {
      setSwitching(undefined)
    }
  }

  return { rows, note, statusNote, current, switching, loadCatalog, loadStatuses, switchTo }
}

export type RcpState = ReturnType<typeof createRcpState>
