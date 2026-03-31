import { Fixture, HandlerDefaults } from "./types.cjs";
import { Journal } from "./journal.cjs";
import * as http from "node:http";

//#region src/messages.d.ts

declare function handleMessages(req: http.IncomingMessage, res: http.ServerResponse, raw: string, fixtures: Fixture[], journal: Journal, defaults: HandlerDefaults, setCorsHeaders: (res: http.ServerResponse) => void): Promise<void>;
//#endregion
export { handleMessages };
//# sourceMappingURL=messages.d.cts.map