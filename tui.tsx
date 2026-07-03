/** @jsxImportSource @opentui/solid */
// Entry point: wires the shared state, the sidebar slot, and the /rcpmodel
// command together. All the logic lives in ./src.

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { config } from "./src/config"
import { createRcpState } from "./src/state"
import { RcpDialog } from "./src/dialog"
import { Sidebar } from "./src/sidebar"
import type { RcpApi } from "./src/types"

const tui: TuiPlugin = async (rawApi) => {
  const api = rawApi as unknown as RcpApi
  const state = createRcpState(api)

  void state.loadCatalog()
  const refresh = setInterval(() => void state.loadCatalog(), config.refreshMs)
  api.lifecycle?.onDispose?.(() => clearInterval(refresh))

  api.slots.register({
    order: 150,
    slots: { sidebar_content: () => <Sidebar api={api} state={state} /> },
  })

  const openDialog = () => {
    void state.loadCatalog()
    void state.probeFavorites()
    api.ui.dialog.replace(() => <RcpDialog api={api} state={state} />)
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
  ])
}

const plugin: TuiPluginModule & { id: string } = { id: "pierre.rcp-status", tui }
export default plugin
