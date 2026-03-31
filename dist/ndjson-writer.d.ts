import { StreamingProfile } from "./types.js";
import * as http from "node:http";

//#region src/ndjson-writer.d.ts

interface NDJSONStreamOptions {
  latency?: number;
  streamingProfile?: StreamingProfile;
  signal?: AbortSignal;
  onChunkSent?: () => void;
}
declare function writeNDJSONStream(res: http.ServerResponse, chunks: object[], options?: NDJSONStreamOptions): Promise<boolean>;
//# sourceMappingURL=ndjson-writer.d.ts.map

//#endregion
export { NDJSONStreamOptions, writeNDJSONStream };
//# sourceMappingURL=ndjson-writer.d.ts.map