import { EmbeddingResponse, FixtureResponse, SSEChunk, ToolCall } from "./types.cjs";
import * as http from "node:http";

//#region src/helpers.d.ts
declare function flattenHeaders(headers: http.IncomingHttpHeaders): Record<string, string>;
declare function generateId(prefix?: string): string;
declare function generateToolCallId(): string;
declare function generateMessageId(): string;
declare function generateToolUseId(): string;
declare function isEmbeddingResponse(r: FixtureResponse): r is EmbeddingResponse;
declare function buildTextChunks(content: string, model: string, chunkSize: number): SSEChunk[];
declare function buildToolCallChunks(toolCalls: ToolCall[], model: string, chunkSize: number): SSEChunk[];
/**
 * Generate a deterministic embedding vector from input text.
 * Hashes the input with SHA-256 and spreads the hash bytes across
 * the requested number of dimensions, producing values in [-1, 1].
 */
declare function generateDeterministicEmbedding(input: string, dimensions?: number): number[];
interface EmbeddingAPIResponse {
  object: "list";
  data: {
    object: "embedding";
    index: number;
    embedding: number[];
  }[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}
/**
 * Build an OpenAI-format embeddings API response for one or more inputs.
 */
declare function buildEmbeddingResponse(embeddings: number[][], model: string): EmbeddingAPIResponse;
//# sourceMappingURL=helpers.d.ts.map
//#endregion
export { EmbeddingAPIResponse, buildEmbeddingResponse, buildTextChunks, buildToolCallChunks, flattenHeaders, generateDeterministicEmbedding, generateId, generateMessageId, generateToolCallId, generateToolUseId, isEmbeddingResponse };
//# sourceMappingURL=helpers.d.cts.map