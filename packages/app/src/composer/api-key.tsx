import { Session } from "@opencode/schema/session"
import { useI18n } from "@opencode/ui/context/i18n"
import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useIntegrations } from "@/providers/catalog/integrations"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import { ComposerEditorConfiguredSelect } from "./editor/editor"
import type { ComposerSelectControl } from "./editor/interaction"

// Draft API keys for not-yet-created chats, keyed by workspace directory. The
// new-session adapter consumes the entry when it creates the session.
const [draftKeys, setDraftKeys] = createStore<Record<string, string | undefined>>({})

export function readDraftApiKey(directory: string | undefined) {
  return directory ? draftKeys[directory] : undefined
}

export function consumeDraftApiKey(directory: string | undefined) {
  const key = readDraftApiKey(directory)

  if (directory) setDraftKeys(directory, undefined)

  return key
}

// Pseudo-ID for "follow whatever Settings says" and for an environment-provided key (e.g. an
// *_API_KEY variable). Neither is ever stored: selecting one clears the override back to the
// active connection.
const DEFAULT_ID = "__default__"
const ENV_ID = "__env__"

/**
 * Per-chat API key picker. The menu is always visible; its first entry reads "Default" and means
 * the chat follows the active Settings key. Picking any saved account pins just that chat to it.
 */
export function ApiKeyControl(props: {
  sessionID: () => string | undefined
  providerID: () => string | undefined
  directory: () => string | undefined
}) {
  const language = useI18n()
  const data = useData()
  const server = useServerSDK()
  const integrations = useIntegrations(() => props.directory())

  const connections = createMemo(() => {
    const providerID = props.providerID()

    return providerID ? (integrations.list().find((item) => item.id === providerID)?.connections ?? []) : []
  })

  const options = createMemo(() => {
    const [active, ...rest] = connections()
    const accounts = (active?.type === "credential" ? [active, ...rest] : rest).filter(
      (connection) => connection.type === "credential",
    )

    const result = [
      ...(active?.type === "env" ? [{ id: ENV_ID, label: `$${active.name}` }] : []),
      ...accounts.map((account) => ({
        id: account.id,
        label: account.label || language.t("ui.promptInput.apiKey.default"),
      })),
    ]

    // A provider with nothing saved still gets a readable entry for the chip.
    if (result.length === 0) return [{ id: DEFAULT_ID, label: language.t("ui.promptInput.apiKey.default") }]

    return result
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
      const raw = data.session.get(sessionID)?.metadata?.[Session.CredentialKey]

      return typeof raw === "string" && raw !== "" ? raw : undefined
    }

    const directory = props.directory()

    return directory ? draftKeys[directory] : undefined
  })

  const current = () => {
    const pinned = override()

    if (pinned && options().some((option) => option.id === pinned)) return pinned

    return defaultID() ?? DEFAULT_ID
  }

  const select = (id: string) => {
    // Picking the active (default) connection unpins the chat instead of storing a redundant override.
    const value = id === defaultID() || id === DEFAULT_ID ? undefined : id
    const sessionID = props.sessionID()

    if (!sessionID) {
      const directory = props.directory()

      if (directory) setDraftKeys(directory, value)

      return
    }

    const metadata = { ...(data.session.get(sessionID)?.metadata ?? {}) }

    if (value === undefined) delete metadata[Session.CredentialKey]
    else metadata[Session.CredentialKey] = value

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
    <ComposerEditorConfiguredSelect title={language.t("ui.promptInput.chooseApiKey")} control={control} />
  )
}
