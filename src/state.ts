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
import type { ModelRef, PluginContext, Readiness, Row } from "./types"

export function createRcpState(context: PluginContext) {
  const [rows, setRows] = createSignal<Row[]>([])
  const [note, setNote] = createSignal("loading…")
  const [readiness, setReadiness] = createSignal<Record<string, Readiness>>({})
  const [switching, setSwitching] = createSignal<string | undefined>(undefined)

  const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info") =>
    context.ui.toast.show({ message, variant, duration: 3000 })

  /** The active RCP model id, when the prompt's selection is an RCP model (reactive). */
  const current = (): string | undefined => {
    const active = activeModel(context)
    return active?.providerID === config.providerId ? active.modelID : undefined
  }

  const loadCatalog = async () => {
    const result = await fetchCatalog()
    if (result.ok) {
      setRows(result.rows)
      setNote(result.warning ?? "")
    } else {
      setNote(result.reason)
    }
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
   * Switch the active model by cycling opencode's favorite ring until the live
   * selection matches the target. Models not in opencode's favorites can't be
   * reached this way, so we open the native picker for those instead.
   */
  const switchTo = async (name: string) => {
    if (switching()) return
    if (current() === name) return void toast(`${shortName(name)} déjà actif`)

    const target: ModelRef = { providerID: config.providerId, modelID: name }
    const ring = cyclableFavorites(context)
    if (!ring.some((fav) => sameModel(fav, target))) {
      toast(`${shortName(name)} n'est pas dans les favoris opencode — ajoute-le via le picker`, "warning")
      runCommand(context, "model.list")
      return
    }

    setSwitching(name)
    try {
      let previous = activeModel(context)
      // One extra step so we can visit every favorite before giving up.
      for (let step = 0; step <= ring.length; step++) {
        runCommand(context, "model.cycle_favorite")
        const active = await waitForActiveChange(context, previous)
        if (sameModel(active, target)) {
          return void toast(`Modèle → ${shortName(name)}`, "success")
        }
        previous = active
      }
      toast(`Impossible de basculer sur ${shortName(name)}`, "error")
    } finally {
      setSwitching(undefined)
    }
  }

  return { rows, note, readiness, current, switching, loadCatalog, probeFavorites, switchTo }
}

export type RcpState = ReturnType<typeof createRcpState>
