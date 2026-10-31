import { onMount, Show } from "solid-js"
import { useI18n } from "@opencode/ui/context/i18n"
import { usePlatform } from "@/runtime/platform/platform"
import { useServer } from "@/runtime/server/current"
import { ComposerEditorConfiguredSelect } from "./editor/editor"
import type { ComposerSelectControl } from "./editor/interaction"
import { mediaConversion } from "./attachments/media"

/** Media conversion as a composer dropdown: Convert media or Raw media. */
export function MediaConversionSelect() {
  const language = useI18n()
  const platform = usePlatform()
  const server = useServer()

  onMount(() => void mediaConversion.load(platform))

  const control: ComposerSelectControl = {
    options: () => [
      { id: "convert", label: language.t("ui.promptInput.mediaConversion.convert") },
      { id: "raw", label: language.t("ui.promptInput.mediaConversion.raw") },
    ],
    current: () => (mediaConversion.enabled() ? "convert" : "raw"),
    onSelect: (id) => void mediaConversion.set(platform, id === "convert"),
  }

  return (
    <Show when={platform.convertMedia && server.isLocal}>
      <ComposerEditorConfiguredSelect title={language.t("ui.promptInput.mediaConversion.title")} control={control} />
    </Show>
  )
}
