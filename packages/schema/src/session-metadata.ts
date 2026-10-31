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
 * Per-chat credential override. When a session's metadata holds this key with
 * a stored credential ID, models in that session resolve with that credential
 * instead of the integration's active one. Applies to any provider; nothing
 * here is OpenRouter-specific.
 */
export const CredentialMetadataKey = "credentialID"
/**
 * Per-chat media conversion override. `false` disables conversion for the chat;
 * anything else falls back to the shared preference.
 */
export const MediaConversionMetadataKey = "mediaConversion"
