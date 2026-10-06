import { app } from "electron"

type Channel = "local" | "dev" | "beta" | "prod" | "omnimodal"

const raw = import.meta.env.OPENCODE_CHANNEL

export const CHANNEL: Channel =
  raw === "local" || raw === "dev" || raw === "beta" || raw === "prod" || raw === "omnimodal" ? raw : "dev"

export const VERSION = app.isPackaged ? app.getVersion() : (process.env.OPENCODE_VERSION ?? app.getVersion())

const appNames: Record<string, string> = {
  dev: "OpenCode Dev",
  beta: "OpenCode Beta",
  prod: "OpenCode",
  omnimodal: "OpenCode Omnimodal",
}

const appIDs: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
  omnimodal: "ai.opencode.desktop.omnimodal",
}

// Local renderer/server mode keeps the dev application identity.
export const APP_NAME = app.isPackaged ? appNames[CHANNEL] : "OpenCode Dev"

export const APP_ID = app.isPackaged ? appIDs[CHANNEL] : "ai.opencode.desktop.dev"
