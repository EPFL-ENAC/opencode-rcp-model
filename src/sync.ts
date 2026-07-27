// Sync opencode.json's epfl-rcp provider with the RCP catalog.
//
// opencode can only select a model its config declares, so the ~280-model
// catalog is useless until the config knows about them. This writes every chat
// model from /v1/model/info into the provider block, keeping cost and context
// limits in step with what RCP actually charges.
//
// The merge is additive and conservative: existing entries keep any hand-written
// display name, models absent from the catalog are never removed, and the file is
// backed up and written atomically (temp + rename) so a failure can't leave a
// truncated config behind.

import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { config } from "./config"
import { fetchModelInfo, shortName } from "./catalog"
import type { ModelInfo } from "./catalog"
import type { RcpApi } from "./types"

/** Used when the catalog reports no limits; opencode needs both fields present. */
const DEFAULT_CONTEXT = 131_072
const DEFAULT_OUTPUT = 8_192

type ModelEntry = {
  name?: string
  cost?: { input: number; output: number }
  limit?: { context: number; output: number }
  [key: string]: unknown
}

export type SyncResult =
  | { ok: true; added: number; updated: number; total: number; path: string; backup: string }
  | { ok: false; reason: string }

/** `api.state.path.config` is a directory in some builds and a file in others. */
function configPath(api: RcpApi): string {
  const configured = api.state?.path?.config
  if (configured?.endsWith(".json")) return configured
  return `${configured ?? `${process.env.HOME}/.config/opencode`}/opencode.json`
}

/**
 * Never overwrite an existing backup: a second sync would otherwise "back up"
 * the file it just wrote, destroying the only copy of the original config.
 */
function backupPath(path: string): string {
  const first = `${path}.bak`
  if (!existsSync(first)) return first
  return `${path}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`
}

/** Embeddings and rerankers can't back a chat session, so they stay out. */
const isChatModel = (info: ModelInfo): boolean => info.mode == null || info.mode === "completion"

/** Build a provider entry, preserving whatever the user already curated. */
function entryFor(name: string, info: ModelInfo, existing: ModelEntry | undefined): ModelEntry {
  const entry: ModelEntry = { ...existing }

  entry.name = existing?.name ?? `${shortName(name)} (EPFL)`

  const { input_cost_per_token: input, output_cost_per_token: output } = info
  if (typeof input === "number" && typeof output === "number") entry.cost = { input, output }

  entry.limit = {
    context: info.max_input_tokens ?? info.max_tokens ?? existing?.limit?.context ?? DEFAULT_CONTEXT,
    output: info.max_output_tokens ?? existing?.limit?.output ?? DEFAULT_OUTPUT,
  }
  return entry
}

/**
 * Merge the RCP catalog into opencode.json. Returns counts for the toast; the
 * caller tells the user to restart, since opencode reads its config at startup.
 */
export async function syncConfig(api: RcpApi): Promise<SyncResult> {
  if (!config.apiKey) return { ok: false, reason: "EPFL_RCP_API_KEY not set" }

  const entries = await fetchModelInfo()
  if (!entries) return { ok: false, reason: "/v1/model/info injoignable (hors VPN ?)" }

  const path = configPath(api)
  let raw: { provider?: Record<string, { models?: Record<string, ModelEntry> }> }
  try {
    raw = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return { ok: false, reason: `${path} illisible (JSON invalide ?)` }
  }

  const provider = raw.provider?.[config.providerId]
  if (!provider) return { ok: false, reason: `provider ${config.providerId} absent de opencode.json` }

  const models = provider.models ?? {}
  const next: Record<string, ModelEntry> = { ...models } // never drops what we don't know about
  let added = 0
  let updated = 0
  for (const { name, info } of entries) {
    if (!name || !isChatModel(info)) continue
    if (models[name]) updated++
    else added++
    next[name] = entryFor(name, info, models[name])
  }

  if (!added && !updated) return { ok: false, reason: "aucun modèle chat dans le catalogue" }

  const backup = backupPath(path)
  try {
    copyFileSync(path, backup)
    const merged = {
      ...raw,
      provider: { ...raw.provider, [config.providerId]: { ...provider, models: next } },
    }
    const temp = `${path}.rcp-tmp`
    writeFileSync(temp, `${JSON.stringify(merged, null, 2)}\n`)
    renameSync(temp, path)
  } catch {
    return { ok: false, reason: `écriture impossible dans ${path}` }
  }

  return { ok: true, added, updated, total: Object.keys(next).length, path, backup }
}
