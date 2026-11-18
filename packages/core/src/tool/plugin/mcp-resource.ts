export * as McpResourceTools from "./mcp-resource.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schema } from "effect"
import { extension } from "mime-types"
import { Mcp } from "../../mcp/index.js"
import { MediaConversion } from "../../media-convert.js"
import { Mime } from "../../mime.js"
import { Permission } from "../../permission.js"

export const Plugin = {
  id: "opencode.tools.mcp-resources",
  effect: Effect.fn("McpResourceTools.Plugin")(function* (ctx: Context) {
    const mcp = yield* Mcp.Service
    const permission = yield* Permission.Service
    const conversion = Option.getOrUndefined(yield* Effect.serviceOption(MediaConversion.Service))

    yield* ctx.tool
      .transform((editor) => {
        editor.add({
          name: "list_mcp_resources",
          options: { namespace: "opencode", codemode: true },
          description:
            "List documents, records, and other data exposed by MCP servers. Use this when the user refers to something that is not a local file, such as a URI with a custom scheme, then load a match with read_mcp_resource. Each entry names the server to read it from. Templates are resources addressed by a parameter such as a record ID; fill in the uriTemplate placeholders before reading.",
          input: Schema.Struct({
            server: Schema.optionalKey(
              Schema.String.annotate({ description: "MCP server name as configured. Omit to list every server." }),
            ),
          }),
          output: Schema.Struct({
            resources: Schema.Array(Mcp.Resource),
            templates: Schema.Array(Mcp.ResourceTemplate),
          }),
          execute: (input, context) =>
            Effect.gen(function* () {
              // Listing every server checks each server name so per-server rules still apply.
              const servers =
                input.server === undefined ? (yield* mcp.servers()).map((server) => server.name) : [input.server]
              yield* permission.assert({
                action: "opencode_list_mcp_resources",
                resources: servers,
                save: servers,
                metadata: {},
                ...Permission.invocation(context),
              })
              if (input.server === undefined) return { output: yield* mcp.resourceCatalog() }
              return { output: yield* mcp.resources({ server: input.server }) }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: error.message, error }))),
        })
        editor.add({
          name: "read_mcp_resource",
          options: { namespace: "opencode", codemode: true },
          description:
            "Read one MCP resource by server and URI. Not for local files. Always return the full contents rather than slicing or filtering them; oversized output is truncated automatically and the full content is saved to a file you can read. Images and PDFs are shown to you directly.",
          input: Schema.Struct({
            server: Schema.String.annotate({
              description: "The server field of the discovered resource.",
            }),
            uri: Schema.String.annotate({
              description: "Exact resource URI from discovery, an expanded uriTemplate, or the user.",
            }),
          }),
          output: Mcp.ResourceContent,
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: "opencode_read_mcp_resource",
                resources: [`${input.server}:${input.uri}`],
                save: [`${input.server}:*`],
                metadata: { server: input.server, uri: input.uri },
                ...Permission.invocation(context),
              })
              const resource = yield* mcp.readResource(input)
              if (!resource)
                return yield* new ToolFailure({
                  message: `MCP server "${input.server}" is not connected or does not expose resources`,
                })
              const content = yield* Effect.forEach(resource.contents, (part) =>
                Effect.gen(function* () {
                  if (part.type !== "blob" || part.mimeType === undefined || !Mime.isMedia(part.mimeType)) return []
                  const mime = part.mimeType.split(";", 1)[0].trim().toLowerCase()
                  const name = mediaName(part.uri, mime)
                  if (conversion !== undefined) {
                    const converted = yield* conversion.convert({
                      bytes: new Uint8Array(Buffer.from(part.blob, "base64")),
                      name,
                      mime,
                    })
                    if (converted?.converted && converted.bytes)
                      return [
                        {
                          type: "file" as const,
                          uri: `data:${converted.mime};base64,${Buffer.from(converted.bytes).toString("base64")}`,
                          mime: converted.mime,
                        },
                      ]
                  }
                  return [{ type: "file" as const, uri: `data:${part.mimeType};base64,${part.blob}`, mime: part.mimeType }]
                }),
              )
              return {
                output: resource,
                content: content.flat(),
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({
                      message: `Unable to read MCP resource ${input.server}:${input.uri}: ${error.message}`,
                      error,
                    }),
              ),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}

const mediaName = (uri: string, mime: string) => {
  const base = uri.split(/[\\/]/).pop()
  if (base && base.includes(".")) return base
  const ext = extension(mime)
  return `mcp-content${ext ? `.${ext}` : ""}`
}
