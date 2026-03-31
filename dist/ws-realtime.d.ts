import { Logger } from "./logger.js";
import { ChatCompletionRequest, Fixture } from "./types.js";
import { Journal } from "./journal.js";
import { WebSocketConnection } from "./ws-framing.js";

//#region src/ws-realtime.d.ts

declare function handleWebSocketRealtime(ws: WebSocketConnection, fixtures: Fixture[], journal: Journal, defaults: {
  latency: number;
  chunkSize: number;
  model: string;
  logger: Logger;
  strict?: boolean;
  requestTransform?: (req: ChatCompletionRequest) => ChatCompletionRequest;
}): void;
//#endregion
export { handleWebSocketRealtime };
//# sourceMappingURL=ws-realtime.d.ts.map