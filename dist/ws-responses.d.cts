import { Logger } from "./logger.cjs";
import { ChatCompletionRequest, Fixture } from "./types.cjs";
import { Journal } from "./journal.cjs";
import { WebSocketConnection } from "./ws-framing.cjs";

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
//# sourceMappingURL=ws-responses.d.cts.map