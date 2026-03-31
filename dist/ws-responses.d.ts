import { Logger } from "./logger.js";
import { ChatCompletionRequest, Fixture } from "./types.js";
import { Journal } from "./journal.js";
import { WebSocketConnection } from "./ws-framing.js";

//#region src/ws-responses.d.ts

declare function handleWebSocketResponses(ws: WebSocketConnection, fixtures: Fixture[], journal: Journal, defaults: {
  latency: number;
  chunkSize: number;
  model: string;
  logger: Logger;
  strict?: boolean;
  requestTransform?: (req: ChatCompletionRequest) => ChatCompletionRequest;
}): void;
//# sourceMappingURL=ws-responses.d.ts.map
//#endregion
export { handleWebSocketResponses };
//# sourceMappingURL=ws-responses.d.ts.map