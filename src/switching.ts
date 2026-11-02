// Model switching via opencode's own favorite-cycle command.
//
// The TUI plugin API has no direct "set active model" call. But
// `keymap.dispatch()` runs the same internal command as the native
// favorite-cycle keybind, which updates the active model (and persists it to
// <state>/model.json). So to switch to a target we cycle through opencode's
// favorites, checking the live selection after each step, until we land on it.
// Only models present in opencode's own favorites are reachable this way.

import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { config } from "./config"
import type { ModelRef, PluginContext } from "./types"
import { delay } from "./util"

export const sameModel = (a: ModelRef | undefined, b: ModelRef | undefined): boolean =>
  !!a && !!b && a.providerID === b.providerID && a.modelID === b.modelID

const modelStatePath = (): string => {
  const stateDir = process.env.XDG_STATE_HOME ?? path.join(homedir(), ".local", "state")
  return path.join(stateDir, "opencode", "model.json")
}

type ModelState = { recent: ModelRef[]; favorite: ModelRef[] }

/** Read opencode's model.json (recent + favorites). Returns empty lists on any error. */
export function readModelState(): ModelState {
  try {
    const json = JSON.parse(readFileSync(modelStatePath(), "utf8"))
    return {
      recent: Array.isArray(json.recent) ? json.recent : [],
      favorite: Array.isArray(json.favorite) ? json.favorite : [],
    }
  } catch {
    return { recent: [], favorite: [] }
  }
}

/** The active model = the prompt's selected model (reactive in Solid computations). */
export const activeModel = (context: PluginContext): ModelRef | undefined => {
  const selection = context.ui.model.current()
  return selection ? { providerID: selection.providerID, modelID: selection.modelID } : undefined
}

/** Run an internal TUI command by id (favorite-cycle, open native picker, …). */
export function runCommand(context: PluginContext, id: string): void {
  context.keymap.dispatch(id)
}

/** Favorites the native cycler will actually visit (it skips unknown provider/model pairs). */
export function cyclableFavorites(context: PluginContext): ModelRef[] {
  const location = context.location ?? context.data.location.default()
  const models = context.data.location.model.list(location) ?? []
  return readModelState().favorite.filter((fav) =>
    models.some((model) => model.providerID === fav.providerID && model.modelID === fav.modelID),
  )
}

/**
 * Poll the live selection until it changes away from `previous` (the update
 * lands a few frames after the command runs), or until timeout.
 */
export async function waitForActiveChange(
  context: PluginContext,
  previous: ModelRef | undefined,
  timeoutMs = 800,
): Promise<ModelRef | undefined> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await delay(40)
    const current = activeModel(context)
    if (current && !sameModel(current, previous)) return current
  }
  return activeModel(context)
}
