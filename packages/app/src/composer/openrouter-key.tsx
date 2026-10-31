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

/**
 * Per-chat OpenRouter key picker. Visible only when the composer targets OpenRouter;
 * the choice is stored on the session so each chat resolves with its own credential.
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

  const accounts = createMemo(() =>
    (integrations.list().find((item) => item.id === "openrouter")?.connections ?? []).filter(
      (connection) => connection.type === "credential",
    ),
  )

  const stored = createMemo(() => {
    const sessionID = props.sessionID()

    if (!sessionID) return undefined
    const raw = data.session.get(sessionID)?.metadata?.[Session.OpenRouterCredentialKey]

    return typeof raw === "string" && raw !== "" ? raw : undefined
  })

  const current = () => stored() ?? readDraftOpenRouterKey(props.directory()) ?? "default"

  const visible = () => props.providerID() === "openrouter" && (accounts().length > 0 || current() !== "default")

  const select = (id: string) => {
    const value = id === "default" ? undefined : id
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
    options: () => [
      { id: "default", label: language.t("ui.promptInput.openRouterKeyDefault") },
      ...accounts().map((account) => ({ id: account.id, label: account.label })),
    ],
    current,
    onSelect: select,
  }

  return (
    <Show when={visible()}>
      <ComposerEditorConfiguredSelect title={language.t("ui.promptInput.chooseOpenRouterKey")} control={control} />
    </Show>
  )
}
