import { StreamingProfile } from "./types.js";
import * as http from "node:http";

//#region src/aws-event-stream.d.ts

/**
 * Encode a single AWS Event Stream binary frame with the given headers and
 * payload buffer.
 */
declare function encodeEventStreamFrame(headers: Record<string, string>, payload: Buffer): Buffer;
/**
 * Encode an event-stream message with standard AWS headers for a JSON event.
 *
 * Sets `:content-type` = `application/json`, `:event-type` = eventType,
 * `:message-type` = `event`.
 */
declare function encodeEventStreamMessage(eventType: string, jsonPayload: object): Buffer;
/**
 * Write a sequence of event-stream frames to an HTTP response with optional
 * timing control. Mirrors the writeSSEStream pattern from sse-writer.ts.
 *
 * Returns `true` when all events are written (including when the response
 * was already ended before writing began), or `false` if interrupted by
 * the provided abort signal.
 */
declare function writeEventStream(res: http.ServerResponse, events: Array<{
  eventType: string;
  payload: object;
}>, options?: {
  latency?: number;
  streamingProfile?: StreamingProfile;
  signal?: AbortSignal;
  onChunkSent?: () => void;
}): Promise<boolean>;
//# sourceMappingURL=aws-event-stream.d.ts.map
//#endregion
export { encodeEventStreamFrame, encodeEventStreamMessage, writeEventStream };
//# sourceMappingURL=aws-event-stream.d.ts.map