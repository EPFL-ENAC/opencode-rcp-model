// Shared types used across the plugin.

export type Pool = "basic" | "premium" | "unknown"

/** Live model state as reported by the portal's models-status endpoint. */
export type Readiness = "ready" | "loading" | "down" | "error" | "unknown"

/** One entry of the models-status payload, normalised. */
export type ModelStatus = { status: Readiness; isAlwaysUp: boolean }

/** A model catalog entry, ready for display. */
export type Row = {
  /** Full model id, e.g. "moonshotai/Kimi-K2.7-Code". */
  name: string
  /** Org-stripped display name, e.g. "Kimi-K2.7-Code". */
  short: string
  /** Favorite index (0-based), or Infinity for non-favorites. See {@link isFavorite}. */
  rank: number
  pool: Pool
  /** Formatted "in/out" per-1M cost, or "" when unknown (off-VPN). */
  cost: string
  /** Combined in+out per-1M price, used for sorting; undefined when unknown. */
  price?: number
  /** LiteLLM mode ("completion", "embedding", …); used to keep chat models only. */
  mode?: string
  /** Live status; unset on freshly-fetched catalog rows, filled in by the merge. */
  readiness?: Readiness
  /** True for models pinned 24/7, false/undefined for autoscaled ones. */
  isAlwaysUp?: boolean
}

export type CatalogResult =
  | { ok: true; rows: Row[]; warning?: string }
  | { ok: false; reason: string }

export type StatusResult =
  | { ok: true; statuses: Record<string, ModelStatus> }
  | { ok: false; reason: string }

/** A provider/model pair as stored in opencode's model.json. */
export type ModelRef = { providerID: string; modelID: string }

/**
 * The subset of the (otherwise loosely-typed) TUI plugin API that this plugin
 * relies on. Declaring it here documents our contract with the host in one place
 * and lets the rest of the code stay free of `any`.
 */
export type RcpApi = {
  state?: {
    path?: { state?: string; config?: string }
    provider?: Array<{ id: string; models?: Record<string, unknown> }>
    config?: { model?: string }
  }
  command?: {
    trigger?: (value: string) => void
    register?: (factory: () => unknown[]) => void
  }
  keymap?: { dispatchCommand?: (value: string) => void }
  ui: {
    DialogSelect: (props: unknown) => unknown
    dialog: { replace: (factory: () => unknown) => void; clear: () => void }
    toast: (opts: { message: string; variant?: string; duration?: number }) => void
  }
  theme: { current: Record<string, string> }
  slots: { register: (plugin: unknown) => void }
  lifecycle?: { onDispose?: (fn: () => void) => void }
}
