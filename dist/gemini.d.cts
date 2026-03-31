import { Fixture, HandlerDefaults, RecordProviderKey } from "./types.cjs";
import { Journal } from "./journal.cjs";
import * as http from "node:http";

//#region src/gemini.d.ts

declare function handleGemini(req: http.IncomingMessage, res: http.ServerResponse, raw: string, model: string, streaming: boolean, fixtures: Fixture[], journal: Journal, defaults: HandlerDefaults, setCorsHeaders: (res: http.ServerResponse) => void, providerKey?: RecordProviderKey): Promise<void>;
//#endregion
export { handleGemini };
//# sourceMappingURL=gemini.d.cts.map