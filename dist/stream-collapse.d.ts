import { Logger } from "./logger.js";
import { RecordProviderKey, ToolCall } from "./types.js";

//#region src/stream-collapse.d.ts

interface CollapseResult {
  content?: string;
  toolCalls?: ToolCall[];
  droppedChunks?: number;
  truncated?: boolean;
}
/**
 * Collapse OpenAI Chat Completions SSE stream into a single response.
 *
 * Format:
 *   data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hello"}}]}\n\n
 *   data: [DONE]\n\n
 */
declare function collapseOpenAISSE(body: string): CollapseResult;
/**
 * Collapse Anthropic Claude Messages SSE stream into a single response.
 *
 * Format:
 *   event: message_start\ndata: {...}\n\n
 *   event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hello"}}\n\n
 */
declare function collapseAnthropicSSE(body: string): CollapseResult;
/**
 * Collapse Gemini SSE stream into a single response.
 *
 * Format (data-only, no event prefix, no [DONE]):
 *   data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n
 */
declare function collapseGeminiSSE(body: string): CollapseResult;
/**
 * Collapse Ollama NDJSON stream into a single response.
 *
 * /api/chat format:
 *   {"model":"llama3","message":{"role":"assistant","content":"Hello"},"done":false}\n
 *
 * /api/generate format:
 *   {"model":"llama3","response":"Hello","done":false}\n
 */
declare function collapseOllamaNDJSON(body: string): CollapseResult;
/**
 * Collapse Cohere SSE stream into a single response.
 *
 * Format:
 *   event: content-delta\ndata: {"type":"content-delta","delta":{"message":{"content":{"text":"Hello"}}}}\n\n
 */
declare function collapseCohereSSE(body: string): CollapseResult;
/**
 * Collapse Bedrock binary Event Stream into a single response.
 *
 * Each frame contains a JSON payload with event types like:
 *   contentBlockDelta, contentBlockStart, etc.
 */
declare function collapseBedrockEventStream(body: Buffer): CollapseResult;
/**
 * Collapse a streaming response body into a non-streaming fixture response.
 * Returns null if the content type is not a known streaming format.
 * Falls back to OpenAI SSE parsing for unrecognized provider keys with text/event-stream.
 */
declare function collapseStreamingResponse(contentType: string, providerKey: RecordProviderKey, body: string | Buffer, logger?: Logger): CollapseResult | null;
//# sourceMappingURL=stream-collapse.d.ts.map
//#endregion
export { CollapseResult, collapseAnthropicSSE, collapseBedrockEventStream, collapseCohereSSE, collapseGeminiSSE, collapseOllamaNDJSON, collapseOpenAISSE, collapseStreamingResponse };
//# sourceMappingURL=stream-collapse.d.ts.map