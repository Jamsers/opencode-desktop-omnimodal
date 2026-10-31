import { Schema } from "effect"

/**
 * Host-supplied session annotations, durable and opaque to core. Keys are
 * arbitrary; values must be JSON-serializable. Children and forks inherit
 * the parent's current metadata unless the creator supplies its own.
 */
export const SessionMetadata = Schema.Record(Schema.String, Schema.Json).annotate({
  identifier: "Session.Metadata",
})
export type SessionMetadata = typeof SessionMetadata.Type

/**
 * Per-chat OpenRouter credential override. When a session's metadata holds
 * this key with a stored credential ID, OpenRouter models in that session
 * resolve with that credential instead of the integration's active one.
 */
export const OpenRouterCredentialMetadataKey = "openrouterCredentialID"
