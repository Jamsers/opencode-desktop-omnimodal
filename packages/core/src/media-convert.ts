export * as MediaConversion from "./media-convert.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { convertMedia, type MediaConversionResult } from "@opencode/util/media-convert"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly convert: (input: { path: string; name: string; mime: string }) => Effect.Effect<MediaConversionResult | null>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/MediaConversion") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return Service.of({
      convert: (input) =>
        Effect.tryPromise({
          try: (signal) => convertMedia({ path: input.path, name: input.name, mime: input.mime }, signal),
          catch: (error) => error,
        }).pipe(Effect.orElseSucceed(() => null)),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
