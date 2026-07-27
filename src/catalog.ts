// Model catalog: fetching model metadata and normalising it into display rows.
// Live status lives in ./status.

import { config, FAVORITES, VARIANT_SUFFIX } from "./config"
import type { CatalogResult, Pool, Row } from "./types"
import { compareNumbers } from "./util"

// --- display helpers --------------------------------------------------------

/** Strip the "org/" prefix from a model id for display. */
export const shortName = (name: string): string =>
  name.includes("/") ? name.slice(name.indexOf("/") + 1) : name

/** Truncate to the sidebar width with a trailing ellipsis. */
export const ellipsize = (s: string): string =>
  s.length > config.truncWidth ? s.slice(0, config.truncWidth - 1) + "…" : s

/** True for rows pinned in {@link FAVORITES} (finite rank). */
export const isFavorite = (row: Row): boolean => Number.isFinite(row.rank)

// --- catalog normalisation --------------------------------------------------

/** Shape of the `model_info` object from the rich `/v1/model/info` endpoint. */
export type ModelInfo = {
  input_cost_per_token?: number
  output_cost_per_token?: number
  rcp_portal_labels?: string[]
  mode?: string
  /** Context window; LiteLLM reports either of these depending on the model. */
  max_tokens?: number
  max_input_tokens?: number
  max_output_tokens?: number
}

export type CatalogEntry = { name: string; info: ModelInfo }

const perMillion = (n: number): string => (n * 1e6).toFixed(2)

const formatCost = (info: ModelInfo): string => {
  const { input_cost_per_token: input, output_cost_per_token: output } = info
  return typeof input === "number" && typeof output === "number"
    ? `${perMillion(input)}/${perMillion(output)}`
    : ""
}

const totalPrice = (info: ModelInfo): number | undefined => {
  const { input_cost_per_token: input, output_cost_per_token: output } = info
  return typeof input === "number" && typeof output === "number" ? (input + output) * 1e6 : undefined
}

const poolOf = (info: ModelInfo): Pool => {
  const labels = info.rcp_portal_labels ?? []
  if (labels.includes("basic")) return "basic"
  if (labels.includes("premium")) return "premium"
  return "unknown"
}

const rankOf = (name: string): number => {
  const index = (FAVORITES as readonly string[]).indexOf(name)
  return index < 0 ? Infinity : index
}

/** Normalise raw catalog entries into sorted display rows (favorites first). */
function buildRows(entries: CatalogEntry[]): Row[] {
  const names = new Set(entries.map((entry) => entry.name))
  const isRedundantVariant = (name: string): boolean => {
    const base = name.replace(VARIANT_SUFFIX, "")
    return base !== name && names.has(base)
  }

  return entries
    .map(({ name, info }) => ({
      name,
      short: shortName(name),
      rank: rankOf(name),
      pool: poolOf(info),
      cost: formatCost(info),
      price: totalPrice(info),
      mode: info.mode,
    }))
    .filter((row) => {
      if (Number.isFinite(row.rank)) return true // always keep favorites
      if (row.mode != null && row.mode !== "completion") return false // chat models only
      return !isRedundantVariant(row.name) // hide quant variants of a listed base
    })
    .sort((a, b) => compareNumbers(a.rank, b.rank) || a.short.toLowerCase().localeCompare(b.short.toLowerCase()))
}

// --- fetching ---------------------------------------------------------------

async function fetchJson(url: string): Promise<unknown | undefined> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(config.timeouts.catalogMs),
    })
    return res.ok ? await res.json() : undefined
  } catch {
    return undefined
  }
}

const dataArray = (json: unknown): Array<Record<string, unknown>> | undefined => {
  const data = (json as { data?: unknown } | undefined)?.data
  return Array.isArray(data) ? data : undefined
}

/**
 * Raw entries from the rich internal endpoint (cost, limits, mode), or undefined
 * when it is unreachable. Used by the catalog below and by the opencode.json sync.
 */
export async function fetchModelInfo(): Promise<CatalogEntry[] | undefined> {
  const rich = dataArray(await fetchJson(config.urls.modelInfo))
  return rich?.map((m) => ({
    name: String(m.model_name ?? ""),
    info: (m.model_info ?? {}) as ModelInfo,
  }))
}

/**
 * Load the model catalog. Tries the rich internal endpoint first (cost/pool),
 * then falls back to the id-only external endpoint, which works off-VPN but
 * without cost/pool metadata.
 */
export async function fetchCatalog(): Promise<CatalogResult> {
  if (!config.apiKey) return { ok: false, reason: "EPFL_RCP_API_KEY not set" }

  const entries = await fetchModelInfo()
  if (entries) return { ok: true, rows: buildRows(entries) }

  const plain = dataArray(await fetchJson(config.urls.models))
  if (plain) {
    const entries = plain.map((m) => ({ name: String(m.id ?? ""), info: {} as ModelInfo }))
    return { ok: true, rows: buildRows(entries), warning: "hors VPN : pas de coût/pool" }
  }

  return { ok: false, reason: "unreachable (clé ? réseau ?)" }
}
