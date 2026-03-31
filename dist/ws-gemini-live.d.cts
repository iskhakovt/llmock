import { Logger } from "./logger.cjs";
import { ChatCompletionRequest, Fixture } from "./types.cjs";
import { Journal } from "./journal.cjs";
import { WebSocketConnection } from "./ws-framing.cjs";

//#region src/ws-gemini-live.d.ts

declare function handleWebSocketGeminiLive(ws: WebSocketConnection, fixtures: Fixture[], journal: Journal, defaults: {
  latency: number;
  chunkSize: number;
  model: string;
  logger: Logger;
  strict?: boolean;
  requestTransform?: (req: ChatCompletionRequest) => ChatCompletionRequest;
}): void;
//# sourceMappingURL=ws-gemini-live.d.ts.map
//#endregion
export { handleWebSocketGeminiLive };
//# sourceMappingURL=ws-gemini-live.d.cts.map