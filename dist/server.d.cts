import { Fixture, HandlerDefaults, MockServerOptions } from "./types.cjs";
import { Journal } from "./journal.cjs";
import * as http from "node:http";

//#region src/server.d.ts
interface ServerInstance {
  server: http.Server;
  journal: Journal;
  url: string;
  defaults: HandlerDefaults;
}
declare function createServer(fixtures: Fixture[], options?: MockServerOptions): Promise<ServerInstance>;
//# sourceMappingURL=server.d.ts.map

//#endregion
export { ServerInstance, createServer };
//# sourceMappingURL=server.d.cts.map