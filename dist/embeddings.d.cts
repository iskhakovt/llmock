import { Fixture, HandlerDefaults } from "./types.cjs";
import { Journal } from "./journal.cjs";
import * as http from "node:http";

//#region src/embeddings.d.ts

declare function handleEmbeddings(req: http.IncomingMessage, res: http.ServerResponse, raw: string, fixtures: Fixture[], journal: Journal, defaults: HandlerDefaults, setCorsHeaders: (res: http.ServerResponse) => void): Promise<void>;
//# sourceMappingURL=embeddings.d.ts.map

//#endregion
export { handleEmbeddings };
//# sourceMappingURL=embeddings.d.cts.map