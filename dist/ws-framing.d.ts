import * as http from "node:http";
import { EventEmitter } from "node:events";
import * as net from "node:net";

//#region src/ws-framing.d.ts

declare class WebSocketConnection extends EventEmitter {
  private socket;
  private buffer;
  private closed;
  private fragments;
  constructor(socket: net.Socket);
  send(data: string): void;
  close(code?: number, reason?: string): void;
  destroy(): void;
  get isClosed(): boolean;
  private writeFrame;
  private parseFrames;
  private handleFrame;
}
declare function computeAcceptKey(wsKey: string): string;
declare function upgradeToWebSocket(req: http.IncomingMessage, socket: net.Socket): WebSocketConnection;
//# sourceMappingURL=ws-framing.d.ts.map
//#endregion
export { WebSocketConnection, computeAcceptKey, upgradeToWebSocket };
//# sourceMappingURL=ws-framing.d.ts.map