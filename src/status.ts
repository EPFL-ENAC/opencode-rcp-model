// Live per-model status from the RCP portal (portal ≥ 1.8.2), authenticated with
// the inference key. Read-only: unlike the old latency probe, nothing here can
// wake a cold model.

import { config, VARIANT_SUFFIX } from "./config"
import type { ModelStatus, Readiness, StatusResult } from "./types"

/** Status values documented by the RCP team; anything else degrades to "unknown". */
const KNOWN = new Set<string>(["ready", "loading", "down", "error"])

/** Best-first order used when merging the statuses of a model's quant variants. */
const PREFERENCE: readonly Readiness[] = ["ready", "loading", "error", "down", "unknown"]

/**
 * Fetch the status of every model the key can reach:
 * `[{ model_name, status, is_always_up }, …]`, keyed by model name.
 */
export async function fetchStatuses(): Promise<StatusResult> {
  if (!config.apiKey) return { ok: false, reason: "EPFL_RCP_API_KEY not set" }

  let res: Response
  try {
    res = await fetch(config.urls.status, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(config.timeouts.statusMs),
    })
  } catch {
    return { ok: false, reason: "statut : injoignable" }
  }

  if (res.status === 401 || res.status === 403) return { ok: false, reason: "statut : clé refusée" }
  if (!res.ok) return { ok: false, reason: `statut : HTTP ${res.status}` }

  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { ok: false, reason: "statut : réponse illisible" }
  }
  if (!Array.isArray(json)) return { ok: false, reason: "statut : format inattendu" }

  const statuses: Record<string, ModelStatus> = {}
  for (const raw of json) {
    const entry = raw as { model_name?: unknown; status?: unknown; is_always_up?: unknown }
    if (typeof entry?.model_name !== "string" || !entry.model_name) continue
    const status = typeof entry.status === "string" && KNOWN.has(entry.status) ? (entry.status as Readiness) : "unknown"
    statuses[entry.model_name] = { status, isAlwaysUp: entry.is_always_up === true }
  }
  return { ok: true, statuses }
}

/**
 * Status of a catalog row. Exact match first; failing that — the catalog may have
 * collapsed quantization variants into a base name — fall back to the best status
 * among that base's variants.
 */
export function statusFor(name: string, statuses: Record<string, ModelStatus>): ModelStatus | undefined {
  const exact = statuses[name]
  if (exact) return exact

  let best: ModelStatus | undefined
  for (const [key, value] of Object.entries(statuses)) {
    if (key.replace(VARIANT_SUFFIX, "") !== name) continue
    if (!best || PREFERENCE.indexOf(value.status) < PREFERENCE.indexOf(best.status)) best = value
  }
  return best
}
