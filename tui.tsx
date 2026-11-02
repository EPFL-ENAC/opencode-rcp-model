/** @jsxImportSource @opentui/solid */
// Entry point: wires the shared state, the sidebar slot, and the /rcpmodel
// command together. All the logic lives in ./src.

import { Plugin } from "@opencode/plugin/tui"
import { config } from "./src/config"
import { createRcpState } from "./src/state"
import { RcpDialog } from "./src/dialog"
import { Sidebar } from "./src/sidebar"

export default Plugin.define({
  id: "epfl.rcp-status",
  setup(context) {
    const state = createRcpState(context)

    void state.loadCatalog()
    const refresh = setInterval(() => void state.loadCatalog(), config.refreshMs)

    const unregisterSlot = context.ui.slot({
      append: "sidebar.content",
      render: () => <Sidebar state={state} />,
    })

    const openDialog = () => {
      void state.loadCatalog()
      void state.probeFavorites()
      context.ui.dialog.show(() => <RcpDialog state={state} />)
    }

    // /rcpmodel (alias /rcp) slash command + command-palette entry, like /models.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "rcp.model.list",
          title: "RCP: switch model",
          group: "Agent",
          palette: true,
          slash: { name: "rcpmodel", aliases: ["rcp"] },
          run: openDialog,
        },
      ],
    }))

    return () => {
      clearInterval(refresh)
      unregisterSlot()
    }
  },
})
