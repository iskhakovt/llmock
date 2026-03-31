import { Logger } from "./logger.js";
import { ChatCompletionRequest, Fixture, RecordConfig, RecordProviderKey } from "./types.js";
import * as http from "node:http";

//#region src/recorder.d.ts

/**
 * Proxy an unmatched request to the real upstream provider, record the
 * response as a fixture on disk and in memory, then relay the response
 * back to the original client.
 *
 * Returns `true` if the request was proxied (provider configured),
 * `false` if no upstream URL is configured for the given provider key.
 */
declare function proxyAndRecord(req: http.IncomingMessage, res: http.ServerResponse, request: ChatCompletionRequest, providerKey: RecordProviderKey, pathname: string, fixtures: Fixture[], defaults: {
  record?: RecordConfig;
  logger: Logger;
  requestTransform?: (req: ChatCompletionRequest) => ChatCompletionRequest;
}, rawBody?: string): Promise<boolean>;
//# sourceMappingURL=recorder.d.ts.map

//#endregion
export { proxyAndRecord };
//# sourceMappingURL=recorder.d.ts.map