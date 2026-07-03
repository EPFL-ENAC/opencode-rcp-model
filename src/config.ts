// Environment-configurable endpoints and static tuning for the RCP plugin.
// Anything a user might reasonably want to change lives here.

/** Internal host (EPFL network / VPN): full API incl. /v1/model/info with cost & pool. */
const INTERNAL_HOST = process.env.RCP_INFER_HOST ?? "https://inference.rcp.epfl.ch"

/** External host (off-VPN): /v1/models + chat completions only. */
const EXTERNAL_HOST = process.env.RCP_INFER_EXT_HOST ?? "https://inference-rcp.epfl.ch"

export const config = {
  apiKey: process.env.EPFL_RCP_API_KEY ?? "",

  /** Provider id as declared in opencode.json. */
  providerId: "epfl-rcp",

  urls: {
    /** Rich catalog (cost/pool/mode) — internal host only, needs EPFL net/VPN. */
    modelInfo: process.env.RCP_MODELINFO_URL ?? `${INTERNAL_HOST}/v1/model/info`,
    /** Id-only catalog — external host, reachable off-VPN. */
    models: `${EXTERNAL_HOST}/v1/models`,
    /** Chat completions, used for readiness probes — external host. */
    chat: `${EXTERNAL_HOST}/v1/chat/completions`,
  },

  timeouts: {
    /** Catalog fetch timeout. */
    catalogMs: 8_000,
    /** Per-favorite readiness probe: a fast 200 means warm, a timeout means cold. */
    probeMs: 5_000,
  },

  /** Catalog refresh interval; metadata only, so no model loads are triggered. */
  refreshMs: 60_000,

  /** Sidebar display-name width (characters). */
  truncWidth: 22,

  /** Max non-favorite models listed in the sidebar (the dialog lists all of them). */
  maxOthers: 12,
} as const

/**
 * Models pinned to the top, probed for readiness, and reachable by one-click switch.
 * These must also be present in opencode's own favorites (see README) for the
 * click-to-switch to work.
 */
export const FAVORITES = [
  "moonshotai/Kimi-K2.7-Code",
  "moonshotai/Kimi-K2.6-int4",
  "Qwen/Qwen3.6-27B",
  "zai-org/GLM-5.2",
] as const

/** Quantization/precision suffixes collapsed when a base model of the same name exists. */
export const VARIANT_SUFFIX = /-(?:float16|float32|bfloat16|fp8|fp4|nvfp4|int4|int8|awq|gptq)$/i
