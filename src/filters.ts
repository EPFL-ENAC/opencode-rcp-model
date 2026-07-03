// Filter and sort definitions for the /rcpmodel dialog.
// Left/right cycles the filter; tab cycles the sort.

import { isFavorite } from "./catalog"
import type { Readiness, Row } from "./types"
import { compareNumbers } from "./util"

export type Filter = {
  label: string
  /** Message shown when the filter matches nothing. */
  empty: string
  match: (row: Row, readiness: Record<string, Readiness>) => boolean
}

export const FILTERS: Filter[] = [
  { label: "tous", empty: "aucun modèle", match: () => true },
  { label: "favoris", empty: "aucun favori", match: (row) => isFavorite(row) },
  {
    label: "prêts",
    empty: "aucun favori prêt — seuls les favoris sont sondés",
    match: (row, readiness) => readiness[row.name] === "warm",
  },
  { label: "gratuits", empty: "aucun modèle basic — pool inconnu hors VPN", match: (row) => row.pool === "basic" },
  { label: "premium", empty: "aucun modèle premium — pool inconnu hors VPN", match: (row) => row.pool === "premium" },
]

const byName = (a: Row, b: Row): number => a.short.toLowerCase().localeCompare(b.short.toLowerCase())

export type Sort = { label: string; compare: (a: Row, b: Row) => number }

export const SORTS: Sort[] = [
  { label: "favoris", compare: (a, b) => compareNumbers(a.rank, b.rank) || byName(a, b) },
  { label: "prix ↑", compare: (a, b) => compareNumbers(a.price ?? Infinity, b.price ?? Infinity) || byName(a, b) },
  { label: "prix ↓", compare: (a, b) => compareNumbers(b.price ?? -Infinity, a.price ?? -Infinity) || byName(a, b) },
  { label: "nom", compare: byName },
]
