import { ChatCompletionRequest, Fixture, HandlerDefaults } from "./types.js";
import { Journal } from "./journal.js";
import * as http from "node:http";

//#region src/bedrock.d.ts

interface BedrockContentBlock {
  type: "text" | "tool_use" | "tool_result" | "image" | "document";
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | BedrockContentBlock[];
  is_error?: boolean;
}
interface BedrockMessage {
  role: "user" | "assistant";
  content: string | BedrockContentBlock[];
}
interface BedrockToolDef {
  name: string;
  description?: string;
  input_schema?: object;
}
interface BedrockRequest {
  anthropic_version?: string;
  messages: BedrockMessage[];
  system?: string | BedrockContentBlock[];
  tools?: BedrockToolDef[];
  tool_choice?: unknown;
  max_tokens: number;
  temperature?: number;
  [key: string]: unknown;
}
declare function bedrockToCompletionRequest(req: BedrockRequest, modelId: string): ChatCompletionRequest;
declare function handleBedrock(req: http.IncomingMessage, res: http.ServerResponse, raw: string, modelId: string, fixtures: Fixture[], journal: Journal, defaults: HandlerDefaults, setCorsHeaders: (res: http.ServerResponse) => void): Promise<void>;
declare function handleBedrockStream(req: http.IncomingMessage, res: http.ServerResponse, raw: string, modelId: string, fixtures: Fixture[], journal: Journal, defaults: HandlerDefaults, setCorsHeaders: (res: http.ServerResponse) => void): Promise<void>;
//#endregion
export { bedrockToCompletionRequest, handleBedrock, handleBedrockStream };
//# sourceMappingURL=bedrock.d.ts.map