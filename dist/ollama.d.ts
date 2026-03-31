import { ChatCompletionRequest, Fixture, HandlerDefaults } from "./types.js";
import { Journal } from "./journal.js";
import * as http from "node:http";

//#region src/ollama.d.ts

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}
interface OllamaToolDef {
  type: string;
  function: {
    name: string;
    description?: string;
    parameters?: object;
  };
}
interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
  tools?: OllamaToolDef[];
}
declare function ollamaToCompletionRequest(req: OllamaRequest): ChatCompletionRequest;
declare function handleOllama(req: http.IncomingMessage, res: http.ServerResponse, raw: string, fixtures: Fixture[], journal: Journal, defaults: HandlerDefaults, setCorsHeaders: (res: http.ServerResponse) => void): Promise<void>;
declare function handleOllamaGenerate(req: http.IncomingMessage, res: http.ServerResponse, raw: string, fixtures: Fixture[], journal: Journal, defaults: HandlerDefaults, setCorsHeaders: (res: http.ServerResponse) => void): Promise<void>;
//#endregion
export { handleOllama, handleOllamaGenerate, ollamaToCompletionRequest };
//# sourceMappingURL=ollama.d.ts.map