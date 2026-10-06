#!/usr/bin/env bun

// Builds the omnimodal fork as its own product: the CLI is a normal OpenCode build (it shares the
// user's background service and data with official installs), while the desktop shell carries the
// fork's identity so its installers co-install beside official OpenCode.
//
//   bun ./scripts/build-omnimodal.ts            # unpacked app in dist/win-unpacked
//   bun ./scripts/build-omnimodal.ts --installer # NSIS installer for GitHub releases
//
// OPENCODE_VERSION sets the fork's product version (default 1.0.0) and is baked into both the CLI
// and the packaged app.

import { $ } from "bun"
import path from "node:path"

const version = Bun.env.OPENCODE_VERSION ?? "1.0.0"
const installer = process.argv.includes("--installer")
const desktop = path.resolve(import.meta.dirname, "..")
const root = path.resolve(desktop, "../..")

process.env.OPENCODE_VERSION = version

process.env.OPENCODE_CHANNEL = "latest"
await $`bun run build -- --single --baseline`.cwd(path.join(root, "packages/cli"))

process.env.OPENCODE_CHANNEL = "omnimodal"
process.env.OPENCODE_CLI_DIST = path.join(root, "packages/cli/dist")
await $`bun ./scripts/prebuild.ts`.cwd(desktop)
await $`bun run build`.cwd(desktop)
await $`bunx electron-builder --win ${installer ? [] : ["--dir"]} --config electron-builder.config.ts`.cwd(desktop)

console.log(`\nOpenCode Omnimodal ${version} built:`)
console.log(`  app:       ${path.join(desktop, "dist/win-unpacked")}`)
if (installer) console.log(`  installer: ${path.join(desktop, "dist")}`)
