/** @jsxImportSource @opentui/solid */
// Entry point: wires the shared state, the sidebar slot, and the /rcpmodel
// command together. All the logic lives in ./src.

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { config } from "./src/config"
import { createRcpState } from "./src/state"
import { RcpDialog } from "./src/dialog"
import { Sidebar } from "./src/sidebar"
import { syncConfig } from "./src/sync"
import type { RcpApi } from "./src/types"

const tui: TuiPlugin = async (rawApi) => {
  const api = rawApi as unknown as RcpApi
  const state = createRcpState(api)

  void state.loadCatalog()
  void state.loadStatuses()
  // Two cadences: the catalog is near-static metadata, the status is live.
  const refresh = setInterval(() => void state.loadCatalog(), config.refreshMs)
  const statusRefresh = setInterval(() => void state.loadStatuses(), config.statusRefreshMs)
  api.lifecycle?.onDispose?.(() => {
    clearInterval(refresh)
    clearInterval(statusRefresh)
  })

  api.slots.register({
    order: 150,
    slots: { sidebar_content: () => <Sidebar api={api} state={state} /> },
  })

  const openDialog = () => {
    void state.loadCatalog()
    void state.loadStatuses()
    api.ui.dialog.replace(() => <RcpDialog api={api} state={state} />)
  }

  /** Declare every RCP chat model in opencode.json so they become selectable. */
  const runSync = async () => {
    api.ui.toast({ message: "Sync opencode.json…", duration: 2000 })
    const result = await syncConfig(api)
    if (!result.ok) return api.ui.toast({ message: `Sync : ${result.reason}`, variant: "error", duration: 6000 })
    api.ui.toast({
      message: `opencode.json : +${result.added} modèles, ${result.updated} mis à jour (${result.total} au total) — redémarre opencode. Sauvegarde : ${result.backup}`,
      variant: "success",
      duration: 8000,
    })
  }

  // /rcpmodel (alias /rcp) slash command + command-palette entry, like /models.
  api.command?.register?.(() => [
    {
      title: "RCP: switch model",
      value: "rcp.model.list",
      category: "Agent",
      slash: { name: "rcpmodel", aliases: ["rcp"] },
      onSelect: openDialog,
    },
    {
      title: "RCP: sync opencode.json with the RCP catalog",
      value: "rcp.model.sync",
      category: "Agent",
      slash: { name: "rcpsync" },
      onSelect: () => void runSync(),
    },
  ])
}

const plugin: TuiPluginModule & { id: string } = { id: "enac-it4r.rcp-model", tui }
export default plugin
