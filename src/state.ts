// Reactive state shared by the sidebar widget and the /rcpmodel dialog.

import { createSignal } from "solid-js"
import { config, FAVORITES } from "./config"
import { fetchCatalog, probeModel, shortName } from "./catalog"
import {
  activeModel,
  cyclableFavorites,
  runCommand,
  sameModel,
  waitForActiveChange,
} from "./switching"
import type { ModelRef, RcpApi, Readiness, Row } from "./types"

export function createRcpState(api: RcpApi) {
  const [rows, setRows] = createSignal<Row[]>([])
  const [note, setNote] = createSignal("loading…")
  const [readiness, setReadiness] = createSignal<Record<string, Readiness>>({})
  const [current, setCurrent] = createSignal<string | undefined>(undefined) // active RCP model id
  const [switching, setSwitching] = createSignal<string | undefined>(undefined)

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
      setRows(result.rows)
      setNote(result.warning ?? "")
    } else {
      setNote(result.reason)
    }
    refreshCurrent()
  }

  let probing = false
  const probeFavorites = async () => {
    if (!config.apiKey || probing) return
    probing = true
    setReadiness(Object.fromEntries(FAVORITES.map((name) => [name, "checking"])))
    try {
      await Promise.all(
        FAVORITES.map(async (name) => {
          const warm = await probeModel(name)
          setReadiness((prev) => ({ ...prev, [name]: warm ? "warm" : "cold" }))
        }),
      )
    } finally {
      probing = false
    }
  }

  /**
   * Switch the active model by cycling opencode's favorite ring until model.json's
   * recent[0] matches the target. Models not in opencode's favorites can't be
   * reached this way, so we open the native picker for those instead.
   */
  const switchTo = async (name: string) => {
    if (switching()) return
    if (current() === name) return void toast(`${shortName(name)} déjà actif`)

    const target: ModelRef = { providerID: config.providerId, modelID: name }
    const ring = cyclableFavorites(api)
    if (!ring.some((fav) => sameModel(fav, target))) {
      toast(`${shortName(name)} n'est pas dans les favoris opencode — ajoute-le via le picker`, "warning")
      runCommand(api, "model.list")
      return
    }

    setSwitching(name)
    try {
      let previous = activeModel(api)
      // One extra step so we can visit every favorite before giving up.
      for (let step = 0; step <= ring.length; step++) {
        runCommand(api, "model.cycle_favorite")
        const active = await waitForActiveChange(api, previous)
        if (sameModel(active, target)) {
          setCurrent(name)
          return void toast(`Modèle → ${shortName(name)}`, "success")
        }
        previous = active
      }
      toast(`Impossible de basculer sur ${shortName(name)}`, "error")
      refreshCurrent()
    } finally {
      setSwitching(undefined)
    }
  }

  return { rows, note, readiness, current, switching, loadCatalog, probeFavorites, switchTo }
}

export type RcpState = ReturnType<typeof createRcpState>
