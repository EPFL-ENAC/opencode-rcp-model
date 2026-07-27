// Model switching via opencode's own favorite-cycle command.
//
// The plugin API has no direct "set active model" call. But `command.trigger()`
// runs the same internal command as the native favorite-cycle keybind, which
// persists the choice to <state>/model.json (recent[0] = active model). So to
// switch to a target we cycle through opencode's favorites, checking recent[0]
// after each step, until we land on it. Only models present in opencode's own
// favorites are reachable this way.

import { readFileSync } from "node:fs"
import { config } from "./config"
import type { ModelRef, RcpApi } from "./types"
import { delay } from "./util"

export const sameModel = (a: ModelRef | undefined, b: ModelRef | undefined): boolean =>
  !!a && !!b && a.providerID === b.providerID && a.modelID === b.modelID

const modelStatePath = (api: RcpApi): string => {
  const stateDir = api.state?.path?.state ?? `${process.env.HOME}/.local/state/opencode`
  return `${stateDir}/model.json`
}

type ModelState = { recent: ModelRef[]; favorite: ModelRef[] }

/** Read opencode's model.json (recent + favorites). Returns empty lists on any error. */
export function readModelState(api: RcpApi): ModelState {
  try {
    const json = JSON.parse(readFileSync(modelStatePath(api), "utf8"))
    return {
      recent: Array.isArray(json.recent) ? json.recent : [],
      favorite: Array.isArray(json.favorite) ? json.favorite : [],
    }
  } catch {
    return { recent: [], favorite: [] }
  }
}

/** The active model = most-recent entry in model.json. */
export const activeModel = (api: RcpApi): ModelRef | undefined => readModelState(api).recent[0]

/** Run an internal TUI command by name (favorite-cycle, open native picker, …). */
export function runCommand(api: RcpApi, value: string): void {
  if (api.command?.trigger) api.command.trigger(value) // opencode <= 1.3
  else api.keymap?.dispatchCommand?.(value) // opencode >= 1.4
}

/**
 * True when opencode's own config declares this model. Undeclared models cannot
 * be selected at all — the cycler skips them — no matter what the favorites say.
 */
export function isDeclared(api: RcpApi, ref: ModelRef): boolean {
  const provider = (api.state?.provider ?? []).find((p) => p.id === ref.providerID)
  return Boolean(provider?.models?.[ref.modelID])
}

/** Favorites the native cycler will actually visit (it skips unknown provider/model pairs). */
export function cyclableFavorites(api: RcpApi): ModelRef[] {
  return readModelState(api).favorite.filter((fav) => isDeclared(api, fav))
}

/**
 * The second ring: models opencode remembers you using. `model.cycle_recent`
 * walks it just like the favorite cycler, so anything listed here is reachable
 * without touching opencode's favorites.
 */
export function cyclableRecents(api: RcpApi): ModelRef[] {
  return readModelState(api).recent.filter((ref) => isDeclared(api, ref))
}

/**
 * The rings a click can actually reach. Adding to them from here is impossible:
 * opencode holds both lists in memory and rewrites model.json from its own copy,
 * so an external write is silently discarded. Anything outside these has to go
 * through the native picker once, which lands it in `recent` for next time.
 */
export function cyclableModels(api: RcpApi): ModelRef[] {
  const favorites = cyclableFavorites(api)
  const extras = cyclableRecents(api).filter((ref) => !favorites.some((fav) => sameModel(fav, ref)))
  return [...favorites, ...extras]
}

/**
 * Poll model.json until recent[0] changes away from `previous` (the file is
 * written asynchronously, ~40-100ms after the command runs), or until timeout.
 */
export async function waitForActiveChange(
  api: RcpApi,
  previous: ModelRef | undefined,
  timeoutMs = 800,
): Promise<ModelRef | undefined> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await delay(40)
    const current = activeModel(api)
    if (current && !sameModel(current, previous)) return current
  }
  return activeModel(api)
}
