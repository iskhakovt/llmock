import { Fixture, HandlerDefaults, ToolCall } from "./types.cjs";
import { Journal } from "./journal.cjs";
import * as http from "node:http";

//#region src/responses.d.ts

interface ResponsesSSEEvent {
  type: string;
  [key: string]: unknown;
}
declare function buildTextStreamEvents(content: string, model: string, chunkSize: number): ResponsesSSEEvent[];
declare function buildToolCallStreamEvents(toolCalls: ToolCall[], model: string, chunkSize: number): ResponsesSSEEvent[];
declare function handleResponses(req: http.IncomingMessage, res: http.ServerResponse, raw: string, fixtures: Fixture[], journal: Journal, defaults: HandlerDefaults, setCorsHeaders: (res: http.ServerResponse) => void): Promise<void>;
//#endregion
export { ResponsesSSEEvent, buildTextStreamEvents, buildToolCallStreamEvents, handleResponses };
//# sourceMappingURL=responses.d.cts.map