import { Session } from "@opencode/schema/session"
import { useI18n } from "@opencode/ui/context/i18n"
import { Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useIntegrations } from "@/providers/catalog/integrations"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import { ComposerEditorConfiguredSelect } from "./editor/editor"
import type { ComposerSelectControl } from "./editor/interaction"

// Draft OpenRouter keys for not-yet-created chats, keyed by workspace directory. The
// new-session adapter consumes the entry when it creates the session.
const [draftKeys, setDraftKeys] = createStore<Record<string, string | undefined>>({})

export function readDraftOpenRouterKey(directory: string | undefined) {
  return directory ? draftKeys[directory] : undefined
}

export function consumeDraftOpenRouterKey(directory: string | undefined) {
  const key = readDraftOpenRouterKey(directory)

  if (directory) setDraftKeys(directory, undefined)

  return key
}

// Pseudo-ID for an environment-provided key (e.g. OPENROUTER_API_KEY). It is never
// stored: selecting it clears the override back to the active connection.
const ENV_ID = "__env__"

/**
 * Per-chat OpenRouter key picker. Visible only when the composer targets OpenRouter
 * and there is more than one key to choose from; the active key from Settings is
 * already selected, picking another pins just this chat to it.
 */
export function OpenRouterKeyControl(props: {
  sessionID: () => string | undefined
  providerID: () => string | undefined
  directory: () => string | undefined
}) {
  const language = useI18n()
  const data = useData()
  const server = useServerSDK()
  const integrations = useIntegrations(() => props.directory())

  const connections = createMemo(
    () => integrations.list().find((item) => item.id === "openrouter")?.connections ?? [],
  )

  const options = createMemo(() => {
    const [active, ...rest] = connections()
    const accounts = (active?.type === "credential" ? [active, ...rest] : rest).filter(
      (connection) => connection.type === "credential",
    )

    return [
      ...(active?.type === "env" ? [{ id: ENV_ID, label: `$${active.name}` }] : []),
      ...accounts.map((account) => ({ id: account.id, label: account.label })),
    ]
  })

  // The Settings default: the active connection, or the first account when nothing is active.
  const defaultID = createMemo(() => {
    const active = connections()[0]

    if (active?.type === "credential") return active.id
    if (active?.type === "env") return ENV_ID

    return options()[0]?.id
  })

  const override = createMemo(() => {
    const sessionID = props.sessionID()

    if (sessionID) {
      const raw = data.session.get(sessionID)?.metadata?.[Session.OpenRouterCredentialKey]

      return typeof raw === "string" && raw !== "" ? raw : undefined
    }

    const directory = props.directory()

    return directory ? draftKeys[directory] : undefined
  })

  const current = () => {
    const pinned = override()

    if (pinned && options().some((option) => option.id === pinned)) return pinned

    return defaultID() ?? options()[0]?.id ?? ""
  }

  const visible = () => props.providerID() === "openrouter" && options().length > 0

  const select = (id: string) => {
    // Re-picking the Settings default unpins the chat instead of storing a redundant override.
    const value = id === defaultID() ? undefined : id
    const sessionID = props.sessionID()

    if (!sessionID) {
      const directory = props.directory()

      if (directory) setDraftKeys(directory, value)

      return
    }

    const metadata = { ...(data.session.get(sessionID)?.metadata ?? {}) }

    if (value === undefined) delete metadata[Session.OpenRouterCredentialKey]
    else metadata[Session.OpenRouterCredentialKey] = value

    void server.api.session
      .update({ sessionID, metadata })
      .catch(() => showToast({ title: language.t("common.requestFailed") }))
  }

  const control: ComposerSelectControl = {
    options,
    current,
    onSelect: select,
  }

  return (
    <Show when={visible()}>
      <ComposerEditorConfiguredSelect title={language.t("ui.promptInput.chooseOpenRouterKey")} control={control} />
    </Show>
  )
}
