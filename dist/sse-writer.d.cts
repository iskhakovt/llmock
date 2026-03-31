import { SSEChunk, StreamingProfile } from "./types.cjs";
import * as http from "node:http";

//#region src/sse-writer.d.ts
declare function delay(ms: number, signal?: AbortSignal): Promise<void>;
interface StreamOptions {
  latency?: number;
  streamingProfile?: StreamingProfile;
  signal?: AbortSignal;
  onChunkSent?: () => void;
}
declare function calculateDelay(chunkIndex: number, profile?: StreamingProfile, fallbackLatency?: number): number;
declare function writeSSEStream(res: http.ServerResponse, chunks: SSEChunk[], optionsOrLatency?: number | StreamOptions): Promise<boolean>;
declare function writeErrorResponse(res: http.ServerResponse, status: number, body: string): void;
//# sourceMappingURL=sse-writer.d.ts.map

//#endregion
export { StreamOptions, calculateDelay, delay, writeErrorResponse, writeSSEStream };
//# sourceMappingURL=sse-writer.d.cts.map