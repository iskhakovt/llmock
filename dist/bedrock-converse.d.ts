import { ChatCompletionRequest, Fixture, HandlerDefaults } from "./types.js";
import { Journal } from "./journal.js";
import * as http from "node:http";

//#region src/bedrock-converse.d.ts

interface ConverseContentBlock {
  text?: string;
  toolUse?: {
    toolUseId: string;
    name: string;
    input: object;
  };
  toolResult?: {
    toolUseId: string;
    content: {
      text?: string;
    }[];
  };
}
interface ConverseMessage {
  role: "user" | "assistant";
  content: ConverseContentBlock[];
}
interface ConverseToolSpec {
  name: string;
  description?: string;
  inputSchema?: object;
}
interface ConverseRequest {
  messages: ConverseMessage[];
  system?: {
    text: string;
  }[];
  inferenceConfig?: {
    maxTokens?: number;
    temperature?: number;
  };
  toolConfig?: {
    tools: {
      toolSpec: ConverseToolSpec;
    }[];
  };
}
declare function converseToCompletionRequest(req: ConverseRequest, modelId: string): ChatCompletionRequest;
declare function handleConverse(req: http.IncomingMessage, res: http.ServerResponse, raw: string, modelId: string, fixtures: Fixture[], journal: Journal, defaults: HandlerDefaults, setCorsHeaders: (res: http.ServerResponse) => void): Promise<void>;
declare function handleConverseStream(req: http.IncomingMessage, res: http.ServerResponse, raw: string, modelId: string, fixtures: Fixture[], journal: Journal, defaults: HandlerDefaults, setCorsHeaders: (res: http.ServerResponse) => void): Promise<void>;
//#endregion
export { converseToCompletionRequest, handleConverse, handleConverseStream };
//# sourceMappingURL=bedrock-converse.d.ts.map