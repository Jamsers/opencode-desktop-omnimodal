import { onMount, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServer } from "@/runtime/server/current"
import { mediaConversion } from "./attachments/media"

/** Global on/off switch for media conversion, shared by attachments and agent reads. */
export function MediaConversionToggle() {
  const platform = usePlatform()
  const server = useServer()
  const language = useLanguage()

  onMount(() => void mediaConversion.load(platform))

  const label = () =>
    mediaConversion.enabled()
      ? language.t("ui.promptInput.mediaConversion.disable")
      : language.t("ui.promptInput.mediaConversion.enable")

  return (
    <Show when={platform.convertMedia && server.isLocal}>
      <Tooltip placement="top" gutter={4} value={label()}>
        <IconButton
          data-action="composer-media-conversion"
          variant="ghost-muted"
          size="normal"
          icon={<Icon name="photo" class={mediaConversion.enabled() ? undefined : "opacity-40"} />}
          aria-label={label()}
          aria-pressed={mediaConversion.enabled()}
          onClick={() => void mediaConversion.set(platform, !mediaConversion.enabled())}
        />
      </Tooltip>
    </Show>
  )
}
