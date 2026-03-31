import { Logger } from "./logger.cjs";
import { ChatCompletionRequest, Fixture } from "./types.cjs";
import { Journal } from "./journal.cjs";
import { WebSocketConnection } from "./ws-framing.cjs";

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
//# sourceMappingURL=ws-realtime.d.cts.map