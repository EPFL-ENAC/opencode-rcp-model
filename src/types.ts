// Shared types used across the plugin.

import type { Plugin } from "@opencode/plugin/tui"

export type Pool = "basic" | "premium" | "unknown"

export type Readiness = "warm" | "cold" | "checking" | "unknown"

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
}

export type CatalogResult =
  | { ok: true; rows: Row[]; warning?: string }
  | { ok: false; reason: string }

/** A provider/model pair as stored in opencode's model.json. */
export type ModelRef = { providerID: string; modelID: string }

/**
 * The OpenCode V2 TUI plugin context. Declaring it here documents our contract
 * with the host in one place and keeps the rest of the code free of `any`.
 */
export type PluginContext = Plugin.Context
