import { Logger } from "./logger.cjs";
import { MetricsRegistry } from "./metrics.cjs";

//#region src/types.d.ts
interface ContentPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}
interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  name?: string;
  tool_calls?: ToolCallMessage[];
  tool_call_id?: string;
}
interface ToolCallMessage {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}
interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  tools?: ToolDefinition[];
  tool_choice?: string | object;
  response_format?: {
    type: string;
    [key: string]: unknown;
  };
  /** Embedding input text, set by the embeddings handler for fixture matching. */
  embeddingInput?: string;
  [key: string]: unknown;
}
interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: object;
  };
}
interface FixtureMatch {
  userMessage?: string | RegExp;
  inputText?: string | RegExp;
  toolCallId?: string;
  toolName?: string;
  model?: string | RegExp;
  responseFormat?: string;
  predicate?: (req: ChatCompletionRequest) => boolean;
  /** Which occurrence of this match to respond to (0-indexed). Undefined means match any. */
  sequenceIndex?: number;
}
interface TextResponse {
  content: string;
  role?: string;
  finishReason?: string;
}
interface ToolCall {
  name: string;
  arguments: string;
  id?: string;
}
interface ToolCallResponse {
  toolCalls: ToolCall[];
  finishReason?: string;
}
interface ErrorResponse {
  error: {
    message: string;
    type?: string;
    code?: string;
  };
  status?: number;
}
interface EmbeddingResponse {
  embedding: number[];
}
type FixtureResponse = TextResponse | ToolCallResponse | ErrorResponse | EmbeddingResponse;
interface StreamingProfile {
  ttft?: number;
  tps?: number;
  jitter?: number;
}
interface ChaosConfig {
  dropRate?: number;
  malformedRate?: number;
  disconnectRate?: number;
}
type ChaosAction = "drop" | "malformed" | "disconnect";
interface Fixture {
  match: FixtureMatch;
  response: FixtureResponse;
  latency?: number;
  chunkSize?: number;
  truncateAfterChunks?: number;
  disconnectAfterMs?: number;
  streamingProfile?: StreamingProfile;
  chaos?: ChaosConfig;
}
type FixtureOpts = Omit<Fixture, "match" | "response">;
type EmbeddingFixtureOpts = Pick<FixtureOpts, "latency" | "chaos">;
interface FixtureFile {
  fixtures: FixtureFileEntry[];
}
interface FixtureFileEntry {
  match: {
    userMessage?: string;
    inputText?: string;
    toolCallId?: string;
    toolName?: string;
    model?: string;
    responseFormat?: string;
    sequenceIndex?: number;
  };
  response: FixtureResponse;
  latency?: number;
  chunkSize?: number;
  truncateAfterChunks?: number;
  disconnectAfterMs?: number;
  streamingProfile?: StreamingProfile;
  chaos?: ChaosConfig;
}
interface JournalEntry {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: ChatCompletionRequest | null;
  response: {
    status: number;
    fixture: Fixture | null;
    interrupted?: boolean;
    interruptReason?: string;
    chaosAction?: ChaosAction;
  };
}
interface SSEChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: SSEChoice[];
}
interface SSEChoice {
  index: number;
  delta: SSEDelta;
  finish_reason: string | null;
}
interface SSEDelta {
  role?: string;
  content?: string | null;
  tool_calls?: SSEToolCallDelta[];
}
interface SSEToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}
type RecordProviderKey = "openai" | "anthropic" | "gemini" | "vertexai" | "bedrock" | "azure" | "ollama" | "cohere";
interface RecordConfig {
  providers: Partial<Record<RecordProviderKey, string>>;
  fixturePath?: string;
}
interface MockServerOptions {
  port?: number;
  host?: string;
  latency?: number;
  chunkSize?: number;
  /** Log verbosity. CLI default is "info"; programmatic default (when omitted) is "silent". */
  logLevel?: "silent" | "info" | "debug";
  chaos?: ChaosConfig;
  /** Enable Prometheus-compatible /metrics endpoint. */
  metrics?: boolean;
  /** Strict mode: return 503 instead of 404 when no fixture matches. */
  strict?: boolean;
  /** Record-and-replay: proxy unmatched requests to upstream and save fixtures. */
  record?: RecordConfig;
  /** Transform requests before fixture matching (e.g. strip dynamic fields for deterministic matching). */
  requestTransform?: (req: ChatCompletionRequest) => ChatCompletionRequest;
}
interface HandlerDefaults {
  latency: number;
  chunkSize: number;
  logger: Logger;
  chaos?: ChaosConfig;
  registry?: MetricsRegistry;
  record?: RecordConfig;
  strict?: boolean;
  requestTransform?: (req: ChatCompletionRequest) => ChatCompletionRequest;
}
//# sourceMappingURL=types.d.ts.map
//#endregion
export { ChaosAction, ChaosConfig, ChatCompletionRequest, ChatMessage, ContentPart, EmbeddingFixtureOpts, EmbeddingResponse, ErrorResponse, Fixture, FixtureFile, FixtureFileEntry, FixtureMatch, FixtureOpts, FixtureResponse, HandlerDefaults, JournalEntry, MockServerOptions, RecordConfig, RecordProviderKey, SSEChoice, SSEChunk, SSEDelta, SSEToolCallDelta, StreamingProfile, TextResponse, ToolCall, ToolCallMessage, ToolCallResponse, ToolDefinition };
//# sourceMappingURL=types.d.cts.map