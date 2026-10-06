#!/usr/bin/env bun

// Builds the omnimodal fork as its own product: the CLI is a normal OpenCode build (it shares the
// user's background service and data with official installs), while the desktop shell carries the
// fork's identity so its installers co-install beside official OpenCode.
//
//   bun ./scripts/build-omnimodal.ts                 # unpacked app for the host platform
//   bun ./scripts/build-omnimodal.ts --installer     # installers for the host platform
//   bun ./scripts/build-omnimodal.ts --installer --target=linux-x64
//
// Targets: win-x64, linux-x64, mac-arm64. electron-builder's packaging tools are host-native
// (mac-arm64 needs macOS; linux-x64 needs macOS or Linux for mksquashfs and fpm), so from Windows
// only win-x64 can build. release-omnimodal.ts builds what each host supports and attaches every
// platform's installers to one GitHub release across machines.
//
// OPENCODE_VERSION sets the fork's product version (default 1.0.0) and is baked into both the CLI
// and the packaged app.

import { $ } from "bun"
import path from "node:path"

export type Target = {
  cliBuild: string
  cliTarget: string
  builder: string
  hosts: string[]
}

export const TARGETS: Record<string, Target> = {
  "win-x64": {
    cliBuild: "opencode-windows-x64-baseline",
    cliTarget: "x86_64-pc-windows-msvc",
    builder: "--win",
    hosts: ["win32", "linux", "darwin"],
  },
  "linux-x64": {
    cliBuild: "opencode-linux-x64-baseline",
    cliTarget: "x86_64-unknown-linux-gnu",
    builder: "--linux",
    hosts: ["linux", "darwin"],
  },
  "mac-arm64": {
    cliBuild: "opencode-darwin-arm64",
    cliTarget: "aarch64-apple-darwin",
    builder: "--mac",
    hosts: ["darwin"],
  },
}

export function hostTargets() {
  return Object.entries(TARGETS)
    .filter(([, target]) => target.hosts.includes(process.platform))
    .map(([name]) => name)
}

if (import.meta.main) {
  const version = Bun.env.OPENCODE_VERSION ?? "1.0.0"
  const installer = process.argv.includes("--installer")
  const name = process.argv.find((arg) => arg.startsWith("--target="))?.slice("--target=".length) ?? defaultHostTarget()
  const target = TARGETS[name]

  if (!target) throw new Error(`Unknown target '${name}'; expected one of ${Object.keys(TARGETS).join(", ")}`)

  if (!target.hosts.includes(process.platform))
    throw new Error(
      `Target ${name} cannot build on ${process.platform}; electron-builder's packaging tools are host-native. Build it on: ${target.hosts.join(", ")}`,
    )

  const desktop = path.resolve(import.meta.dirname, "..")
  const root = path.resolve(desktop, "../..")

  process.env.OPENCODE_VERSION = version

  process.env.OPENCODE_CHANNEL = "latest"
  await $`bun run build -- --target=${target.cliBuild}`.cwd(path.join(root, "packages/cli"))

  process.env.OPENCODE_CHANNEL = "omnimodal"
  process.env.OPENCODE_CLI_DIST = path.join(root, "packages/cli/dist")
  process.env.OPENCODE_CLI_TARGET = target.cliTarget
  await $`bun ./scripts/prebuild.ts`.cwd(desktop)
  await $`bun run build`.cwd(desktop)
  await $`bunx electron-builder ${target.builder} ${installer ? [] : ["--dir"]} --config electron-builder.config.ts`.cwd(
    desktop,
  )

  console.log(`\nOpenCode Omnimodal ${version} (${name}) built in ${path.join(desktop, "dist")}`)
}

function defaultHostTarget() {
  if (process.platform === "darwin") return "mac-arm64"
  if (process.platform === "linux") return "linux-x64"
  return "win-x64"
}
