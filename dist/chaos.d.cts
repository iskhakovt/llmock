import { Logger } from "./logger.cjs";
import { MetricsRegistry } from "./metrics.cjs";
import { ChaosAction, ChaosConfig, ChatCompletionRequest, Fixture } from "./types.cjs";
import { Journal } from "./journal.cjs";
import * as http from "node:http";

//#region src/chaos.d.ts

/**
 * Evaluate chaos config and return the triggered action, or null if none.
 * Checks in order: drop, malformed, disconnect — first hit wins.
 */
declare function evaluateChaos(fixture: Fixture | null, serverDefaults?: ChaosConfig, rawHeaders?: http.IncomingHttpHeaders, logger?: Logger): ChaosAction | null;
interface ChaosJournalContext {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: ChatCompletionRequest;
}
/**
 * Apply chaos to a request. Returns true if chaos was applied (caller should
 * return early), false if the request should proceed normally.
 */
declare function applyChaos(res: http.ServerResponse, fixture: Fixture | null, serverDefaults: ChaosConfig | undefined, rawHeaders: http.IncomingHttpHeaders, journal: Journal, context: ChaosJournalContext, registry?: MetricsRegistry, logger?: Logger): boolean;
//#endregion
export { applyChaos, evaluateChaos };
//# sourceMappingURL=chaos.d.cts.map