export * as SessionRunnerModel from "./model.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { LanguageModel } from "@opencode/ai/effect"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Context, Effect, Layer, Schema } from "effect"
import { Agent } from "../../agent.js"
import { Credential } from "../../credential.js"
import { IntegrationConnection } from "../../integration/connection.js"
import { ModelResolver } from "../../model-resolver.js"
import { SessionSchema } from "../schema.js"

export class ModelNotSelectedError extends Schema.TaggedError<ModelNotSelectedError>()(
  "SessionRunnerModel.ModelNotSelectedError",
  { sessionID: SessionSchema.ID },
) {
  override get message() {
    return `No model is available for session ${this.sessionID}`
  }
}

export class ModelUnavailableError extends Schema.TaggedError<ModelUnavailableError>()(
  "SessionRunnerModel.ModelUnavailableError",
  { providerID: Provider.ID, modelID: Model.ID },
) {
  override get message() {
    if (this.providerID === "azure-cognitive-services")
      return `Model unavailable: ${this.providerID}/${this.modelID}. This provider has been deprecated; use azure/${this.modelID} instead.`
    if (this.providerID === "google-vertex-anthropic")
      return `Model unavailable: ${this.providerID}/${this.modelID}. This provider has been deprecated; use google-vertex/${this.modelID} instead.`
    return `Model unavailable: ${this.providerID}/${this.modelID}`
  }
}
export type Error = ModelNotSelectedError | ModelUnavailableError | ModelResolver.Error
export type Resolved = ModelResolver.Resolved

export interface Interface {
  /** Availability is sampled lazily for each explicitly selected model resolution. */
  readonly resolve: (
    session: SessionSchema.Info,
    available: () => Effect.Effect<ReadonlyArray<Model.Info>>,
  ) => Effect.Effect<Resolved, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionRunnerModel") {}

/** Builds a Resolved whose catalog identity mirrors the route model. Test or embedding seam. */
export const resolved = (
  model: LanguageModel,
  options: {
    readonly capabilities: Model.Capabilities
    readonly variant?: Model.VariantID
    readonly cost: Model.Info["cost"]
    readonly limit: Model.Info["limit"]
    readonly compaction?: Provider.Compaction
    readonly transport?: Provider.Transport
  },
): Resolved => ({
  model,
  ref: Model.Ref.make({
    id: Model.ID.make(model.id),
    providerID: Provider.ID.make(model.provider),
    ...(options.variant === undefined ? {} : { variant: options.variant }),
  }),
  capabilities: options.capabilities,
  cost: options.cost,
  limit: options.limit,
  compaction: options.compaction,
  transport: options.transport,
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const resolver = yield* ModelResolver.Service
    const agents = yield* Agent.Service
    return Service.of({
      resolve: Effect.fn("SessionRunnerModel.resolve")(function* (session, available) {
        // Location plugins populate and filter the catalog asynchronously during layer startup.
        const override = credentialConnectionOverride(session)
        if (!session.model) {
          const agent = (yield* agents.select(session.agent)).info?.model
          const preferred =
            agent &&
            (yield* available()).find((model) => model.providerID === agent.providerID && model.id === agent.id)
          if (preferred) {
            if (override) return yield* resolver.resolveModelWithConnection(preferred, agent.variant, override)
            return yield* resolver.resolveModel(preferred, agent.variant)
          }
          const resolved = yield* resolver.resolve()
          if (!resolved) return yield* new ModelNotSelectedError({ sessionID: session.id })
          if (!override) return resolved
          // A pinned key applies to the default model too, instead of being dropped.
          const info = (yield* available()).find(
            (model) => model.providerID === resolved.ref.providerID && model.id === resolved.ref.id,
          )
          if (!info) return resolved
          return yield* resolver.resolveModelWithConnection(info, resolved.ref.variant, override)
        }
        const selected = (yield* available()).find(
          (model) => model.providerID === session.model?.providerID && model.id === session.model.id,
        )
        if (!selected)
          return yield* new ModelUnavailableError({
            providerID: session.model.providerID,
            modelID: session.model.id,
          })
        if (override) return yield* resolver.resolveModelWithConnection(selected, session.model.variant, override)
        return yield* resolver.resolveModel(selected, session.model.variant)
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [ModelResolver.node, Agent.node] })

/**
 * Explicit credential for one session, from its durable metadata. Only stored
 * credential IDs are honored; anything else falls back to the integration's
 * active connection at resolve time.
 */
function credentialConnectionOverride(session: SessionSchema.Info): IntegrationConnection.Info | undefined {
  const raw = session.metadata?.[SessionSchema.CredentialKey]
  if (typeof raw !== "string" || !raw.startsWith("cred_")) return undefined
  return {
    type: "credential",
    id: Credential.ID.make(raw),
    label: "",
    method: "key",
  }
}
