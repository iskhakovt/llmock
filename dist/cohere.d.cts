import { ChatCompletionRequest, Fixture, HandlerDefaults } from "./types.cjs";
import { Journal } from "./journal.cjs";
import * as http from "node:http";

//#region src/cohere.d.ts

interface CohereMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_call_id?: string;
}
interface CohereToolDef {
  type: string;
  function: {
    name: string;
    description?: string;
    parameters?: object;
  };
}
interface CohereRequest {
  model: string;
  messages: CohereMessage[];
  stream?: boolean;
  tools?: CohereToolDef[];
  response_format?: {
    type: string;
    json_schema?: object;
  };
}
declare function cohereToCompletionRequest(req: CohereRequest): ChatCompletionRequest;
declare function handleCohere(req: http.IncomingMessage, res: http.ServerResponse, raw: string, fixtures: Fixture[], journal: Journal, defaults: HandlerDefaults, setCorsHeaders: (res: http.ServerResponse) => void): Promise<void>;
//#endregion
export { cohereToCompletionRequest, handleCohere };
//# sourceMappingURL=cohere.d.cts.map