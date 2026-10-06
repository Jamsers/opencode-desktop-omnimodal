#!/usr/bin/env bun

// Creates an OpenCode Omnimodal release. Mirrors upstream's release shape (a version tag plus
// per-platform installers and updater manifests) with two fork-specific rules: product versions
// stay on the 1.x line and never reuse upstream's 2.x numbers, and release tags are namespaced
// omnimodal-v<version> because upstream's legacy v1.x tags saturate plain v1.x. The app's updater
// reads the version from latest.yml, so the tag prefix is free.
//
//   bun ./scripts/release-omnimodal.ts 1.0.2                          # build + release
//   bun ./scripts/release-omnimodal.ts --bump=patch --dry-run         # rehearse the next patch
//   bun ./scripts/release-omnimodal.ts --attach 1.0.2 --targets=linux-x64,mac-arm64
//
// electron-builder's packaging tools are host-native, so one machine cannot build every platform.
// Run the script once to create the release with the host's platforms, then run it again on other
// hosts with --attach to add their installers to the same release. Assets are read from
// packages/desktop/dist and staged under dist/release/<version>/.

import { $ } from "bun"
import path from "node:path"
import { TARGETS, hostTargets } from "./build-omnimodal"

const REPO = Bun.env.GH_REPO ?? "Jamsers/opencode-desktop-omnimodal"
const desktop = path.resolve(import.meta.dirname, "..")

// electron-updater resolves the installer from the same release via the manifest's relative file
// names; each platform reads only its own manifest.
const MANIFESTS: Record<string, string> = {
  "win-x64": "latest.yml",
  "linux-x64": "latest-linux.yml",
  "mac-arm64": "latest-mac.yml",
}

const args = process.argv.slice(2)
const attach = args.includes("--attach")
const dryRun = args.includes("--dry-run")
const skipBuild = args.includes("--skip-build")
const bump = args.find((arg) => arg.startsWith("--bump="))?.slice("--bump=".length)
const notesFile = args.find((arg) => arg.startsWith("--notes="))?.slice("--notes=".length)
const requestedTargets = args.find((arg) => arg.startsWith("--targets="))?.slice("--targets=".length)
const version = args.find((arg) => /^\d+\.\d+\.\d+$/.test(arg)) ?? (await bumpedVersion(bump))

// Fork versions start at 1.0.0 and never follow upstream's 2.x numbering (AGENTS.md, Fork Build).
if (!/^1\.\d+\.\d+$/.test(version))
  throw new Error(`Invalid fork version '${version}': releases use 1.x.y and never reuse upstream 2.x numbers`)

const tag = `omnimodal-v${version}`
const existing = await $`git tag --list ${tag}`.text().then((out) => out.trim())

if (attach && !existing) throw new Error(`Cannot attach: ${tag} does not exist; run a full release first`)

if (!attach && existing) throw new Error(`${tag} already exists; use --attach to add assets to it`)

const targets = requestedTargets ? requestedTargets.split(",") : hostTargets()

for (const name of targets) {
  const target = TARGETS[name]

  if (!target) throw new Error(`Unknown target '${name}'; expected one of ${Object.keys(TARGETS).join(", ")}`)

  if (!target.hosts.includes(process.platform))
    throw new Error(`Target ${name} cannot build on ${process.platform}; build it on: ${target.hosts.join(", ")}`)
}

const staging = path.join(desktop, "dist", "release", version)

process.env.OPENCODE_VERSION = version

// --skip-build republishes from an existing dist, for recovering a partially uploaded release.
if (!skipBuild)
  for (const name of targets) {
    console.log(`\n=== building ${name} ===\n`)
    await $`bun ./scripts/build-omnimodal.ts --installer --target=${name}`.cwd(desktop)
  }

const assets = await stage()

if (dryRun) {
  console.log(`\ndry run: would publish ${tag} to ${REPO} with:`)
  for (const asset of assets) console.log(`  ${path.basename(asset)}`)
  process.exit(0)
}

if (attach) {
  await publish(assets)
  console.log(`\nAttached to ${tag}: https://github.com/${REPO}/releases/tag/${tag}`)
  process.exit(0)
}

await publish(assets, notesFile ? await Bun.file(notesFile).text() : await releaseNotes())
console.log(`\nReleased ${tag}: https://github.com/${REPO}/releases/tag/${tag}`)

async function stage() {
  await Bun.$`mkdir -p ${staging}`
  const files = (
    await Array.fromAsync(
      new Bun.Glob(`opencode-desktop-omnimodal-{${targets.join(",")}}.{exe*,deb,rpm,AppImage*,dmg,zip*}`).scan({
        cwd: path.join(desktop, "dist"),
      }),
    )
  ).sort()

  for (const name of targets) files.push(MANIFESTS[name]!)

  for (const file of files) await Bun.$`cp ${path.join(desktop, "dist", file)} ${staging}`
  return files.map((file) => path.join(staging, file))
}

async function publish(assets: string[], notes = "") {
  const token = await githubToken()

  if (!token) throw new Error("No GitHub credentials: set GH_TOKEN or authenticate git for github.com")

  const releaseId = attach ? (await existingRelease(token)).id : (await createRelease(token, notes)).id

  for (const asset of assets) await uploadAsset(token, releaseId, asset)
}

async function createRelease(token: string, notes: string) {
  const head = await $`git rev-parse HEAD`.text().then((out) => out.trim())
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: head,
      name: `OpenCode Omnimodal v${version}`,
      body: notes,
      draft: false,
      prerelease: false,
    }),
  })

  if (!response.ok) throw new Error(`Failed to create release: ${response.status} ${await response.text()}`)
  return (await response.json()) as { id: number }
}

async function existingRelease(token: string) {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: headers(token),
  })

  if (!response.ok) throw new Error(`Failed to find ${tag}: ${response.status} ${await response.text()}`)
  return (await response.json()) as { id: number; assets: { name: string }[] }
}

async function uploadAsset(token: string, releaseId: number, file: string) {
  const name = path.basename(file)

  if (attach) {
    const release = await existingRelease(token)

    if (release.assets.some((asset) => asset.name === name)) {
      console.log(`kept:   ${name}`)
      return
    }
  }

  console.log(`upload: ${name}`)
  const response = await fetch(
    `https://uploads.github.com/repos/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`,
    {
      method: "POST",
      headers: { ...headers(token), "Content-Type": "application/octet-stream" },
      body: Bun.file(file),
    },
  )

  if (!response.ok) throw new Error(`Failed to upload ${name}: ${response.status} ${await response.text()}`)
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "opencode-omnimodal-release",
  }
}

async function githubToken() {
  const fromEnv = Bun.env.GH_TOKEN ?? Bun.env.GITHUB_TOKEN
  if (fromEnv) return fromEnv
  const proc = Bun.spawn(["git", "credential", "fill"], { stdin: "pipe", stdout: "pipe" })
  proc.stdin.write("protocol=https\nhost=github.com\n\n")
  proc.stdin.end()
  const out = await new Response(proc.stdout).text()
  await proc.exited
  return out
    .split("\n")
    .find((line) => line.startsWith("password="))
    ?.slice("password=".length)
}

async function bumpedVersion(kind: string | undefined) {
  if (!kind) throw new Error("Pass a version (1.0.2) or --bump=patch|minor|major")
  const latest = await $`git tag --list "omnimodal-v*" --sort=-version:refname`
    .text()
    .then((out) => out.split("\n")[0]?.trim())

  if (!latest) throw new Error("No omnimodal-v* tags yet; pass an explicit version for the first release")
  const [major = 0, minor = 0, patch = 0] = latest.slice("omnimodal-v".length).split(".").map(Number)
  if (kind === "major") return `${major + 1}.0.0`
  if (kind === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

async function releaseNotes() {
  const base = await $`git tag --list "omnimodal-v*" --sort=-version:refname`
    .text()
    .then((out) => out.split("\n")[0]?.trim())
  const upstream = await $`git describe --tags --abbrev=0 --match="v2.*" HEAD`
    .text()
    .then((out) => out.trim())
    .catch(() => "unknown")
  const log = await $`git log --oneline --no-merges ${base ? `${base}..HEAD` : "-15"}`.text()
  return `Personal OpenCode fork with omnimodal file ingestion: audio, video, and document attachments (OpenRouter \`file\` inputs) via drag-and-drop, paste, \`@\` mentions, and agent Reads.

Built on upstream OpenCode ${upstream}.

### Install

- **Windows** — \`opencode-desktop-omnimodal-win-x64.exe\`. Co-installs beside official OpenCode and shares settings and sessions; quit one app before launching the other. The installer is unsigned, so SmartScreen warns on first run.
- **Linux** — AppImage (auto-updates), .deb, .rpm.
- **macOS** — Apple Silicon installers attach to this release when built from a macOS host.

### Changes

${log.trim()}`
}
