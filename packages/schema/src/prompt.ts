import { Schema } from "effect"
import { optional } from "./schema.js"
import { statics } from "./schema.js"
import { Skill } from "./skill.js"

export interface PromptMention extends Schema.Schema.Type<typeof PromptMention> {}
export const PromptMention = Schema.Struct({
  start: Schema.Finite,
  end: Schema.Finite,
  text: Schema.String,
}).annotate({ identifier: "Prompt.Mention" })

export const FileSource = Schema.Union([
  Schema.Struct({ type: Schema.Literal("inline") }),
  Schema.Struct({ type: Schema.Literal("uri"), uri: Schema.String }),
])
  .pipe(Schema.toTaggedUnion("type"))
  .annotate({ identifier: "Prompt.FileSource" })
export type FileSource = typeof FileSource.Type

// The equivalent regex fails on large payloads in some engines (JSC rejects canonical base64 above
// roughly 9 MB), so validate in a single linear pass instead. The pattern stays as an annotation so
// the generated OpenAPI document still documents the same constraint.
const base64Pattern = {
  source: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
  flags: "u",
}

export const Base64 = Schema.String.check(
  Schema.makeFilter(isBase64, {
    expected: `a string matching the RegExp ${base64Pattern.source}`,
    representation: { id: "effect/schema/isPattern", payload: base64Pattern },
    toJsonSchema: () => ({ pattern: base64Pattern.source }),
    arbitraryConstraint: { patterns: [base64Pattern] },
  }),
).annotate({ identifier: "Prompt.Base64" })
export type Base64 = typeof Base64.Type

function isBase64(value: string) {
  if (value.length === 0) return true
  if (value.length % 4 !== 0) return false

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0
  const body = value.length - padding

  // Padding only terminates the final quad: one `=` follows three characters, two follow two.
  if (padding === 1 && body % 4 !== 3) return false
  if (padding === 2 && body % 4 !== 2) return false

  for (let index = 0; index < body; index++) {
    const code = value.charCodeAt(index)
    const valid =
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      (code >= 0x30 && code <= 0x39) ||
      code === 0x2b ||
      code === 0x2f
    if (!valid) return false
  }

  return true
}

export interface FileAttachment extends Schema.Schema.Type<typeof FileAttachment> {}
export const FileAttachment = Schema.Struct({
  data: Base64,
  mime: Schema.String,
  source: FileSource,
  name: Schema.String.pipe(optional),
  description: Schema.String.pipe(optional),
  mention: PromptMention.pipe(optional),
})
  .annotate({ identifier: "Prompt.FileAttachment" })
  .pipe(
    statics((schema) => ({
      create: (input: FileAttachment) =>
        schema.make({
          data: input.data,
          mime: input.mime,
          source: input.source,
          name: input.name,
          description: input.description,
          mention: input.mention,
        }),
    })),
  )

export interface AgentAttachment extends Schema.Schema.Type<typeof AgentAttachment> {}
export const AgentAttachment = Schema.Struct({
  name: Schema.String,
  mention: PromptMention.pipe(optional),
}).annotate({ identifier: "Prompt.AgentAttachment" })

export interface SkillAttachment extends Schema.Schema.Type<typeof SkillAttachment> {}
export const SkillAttachment = Schema.Struct({
  id: Skill.ID,
  name: Skill.Name,
  text: Schema.String.pipe(optional),
  mention: PromptMention.pipe(optional),
}).annotate({ identifier: "Prompt.SkillAttachment" })

export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}
export const Prompt = Schema.Struct({
  text: Schema.String,
  files: Schema.Array(FileAttachment).pipe(optional),
  agents: Schema.Array(AgentAttachment).pipe(optional),
  skills: Schema.Array(SkillAttachment).pipe(optional),
})
  .annotate({ identifier: "Prompt" })
  .pipe(
    statics((schema) => ({
      equivalence: Schema.toEquivalence(schema),
      fromUserMessage: (input: Pick<Prompt, "text" | "files" | "agents" | "skills">) =>
        schema.make({
          text: input.text,
          ...(input.files === undefined ? {} : { files: input.files }),
          ...(input.agents === undefined ? {} : { agents: input.agents }),
          ...(input.skills === undefined ? {} : { skills: input.skills }),
        }),
    })),
  )
