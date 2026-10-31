import { Session } from "@opencode/schema/session"
import { onMount, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useI18n } from "@opencode/ui/context/i18n"
import { usePlatform } from "@/runtime/platform/platform"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { showToast } from "@/shell/notifications/toast"
import { ComposerEditorConfiguredSelect } from "./editor/editor"
import type { ComposerSelectControl } from "./editor/interaction"
import { mediaConversion } from "./attachments/media"

// Draft conversion choices for not-yet-created chats, keyed by workspace directory. The
// new-session adapter consumes the entry when it creates the session.
const [draftChoices, setDraftChoices] = createStore<Record<string, boolean | undefined>>({})

export function readDraftMediaConversion(directory: string | undefined) {
  return directory ? draftChoices[directory] : undefined
}

export function consumeDraftMediaConversion(directory: string | undefined) {
  const choice = readDraftMediaConversion(directory)

  if (directory) setDraftChoices(directory, undefined)

  return choice
}

/** Per-chat media conversion dropdown: Convert media or Raw media. */
export function MediaConversionSelect(props: {
  sessionID: () => string | undefined
  directory: () => string | undefined
}) {
  const language = useI18n()
  const platform = usePlatform()
  const data = useData()
  const server = useServerSDK()

  onMount(() => void mediaConversion.load(platform))

  const override = createMemo(() => {
    const sessionID = props.sessionID()

    if (sessionID) {
      const raw = data.session.get(sessionID)?.metadata?.[Session.MediaConversionKey]

      return typeof raw === "boolean" ? raw : undefined
    }

    const directory = props.directory()

    return directory ? draftChoices[directory] : undefined
  })

  const control: ComposerSelectControl = {
    options: () => [
      { id: "convert", label: language.t("ui.promptInput.mediaConversion.convert") },
      { id: "raw", label: language.t("ui.promptInput.mediaConversion.raw") },
    ],
    current: () => ((override() ?? mediaConversion.enabled()) ? "convert" : "raw"),
    onSelect: (id) => {
      // Picking the shared default unpins the chat instead of storing a redundant override.
      const value = id === "convert"
      const next = value === mediaConversion.enabled() ? undefined : value
      const sessionID = props.sessionID()

      if (!sessionID) {
        const directory = props.directory()

        if (directory) setDraftChoices(directory, next)

        return
      }

      const metadata = { ...(data.session.get(sessionID)?.metadata ?? {}) }

      if (next === undefined) delete metadata[Session.MediaConversionKey]
      else metadata[Session.MediaConversionKey] = next

      void server.api.session
        .update({ sessionID, metadata })
        .catch(() => showToast({ title: language.t("common.requestFailed") }))
    },
  }

  return (
    <ComposerEditorConfiguredSelect title={language.t("ui.promptInput.mediaConversion.title")} control={control} />
  )
}
