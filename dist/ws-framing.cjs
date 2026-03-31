const require_runtime = require('./_virtual/_rolldown/runtime.cjs');
let node_crypto = require("node:crypto");
let node_events = require("node:events");

//#region src/ws-framing.ts
/**
* Minimal RFC 6455 WebSocket server implementation.
*
* Zero dependencies — uses only Node.js builtins (node:crypto, node:events).
* Supports text frames, ping/pong, close handshake, and client frame unmasking.
* Designed for a mock server — no extensions, no binary frames, no compression.
*/
const WS_GUID = "258EAFA5-E914-47DA-95CA-5AB5DC799C07";
const OP_CONTINUATION = 0;
const OP_TEXT = 1;
const OP_CLOSE = 8;
const OP_PING = 9;
const OP_PONG = 10;
var WebSocketConnection = class extends node_events.EventEmitter {
	socket;
	buffer = Buffer.alloc(0);
	closed = false;
	fragments = [];
	constructor(socket) {
		super();
		this.socket = socket;
		socket.on("data", (data) => {
			this.buffer = Buffer.concat([this.buffer, data]);
			this.parseFrames();
		});
		socket.on("close", () => {
			if (!this.closed) {
				this.closed = true;
				this.emit("close", 1006, "Connection lost");
			}
		});
		socket.on("error", (err) => {
			this.emit("error", err);
		});
	}
	send(data) {
		if (this.closed) return;
		const payload = Buffer.from(data, "utf-8");
		this.writeFrame(OP_TEXT, payload);
	}
	close(code = 1e3, reason = "") {
		if (this.closed) return;
		this.closed = true;
		const reasonBuf = Buffer.from(reason, "utf-8");
		const payload = Buffer.alloc(2 + reasonBuf.length);
		payload.writeUInt16BE(code, 0);
		reasonBuf.copy(payload, 2);
		this.writeFrame(OP_CLOSE, payload);
		setTimeout(() => {
			if (!this.socket.destroyed) this.socket.destroy();
			this.emit("close", code, reason);
		}, 100);
	}
	destroy() {
		if (this.closed) return;
		this.closed = true;
		if (!this.socket.destroyed) this.socket.destroy();
		this.emit("close", 1006, "Connection destroyed");
	}
	get isClosed() {
		return this.closed;
	}
	writeFrame(opcode, payload) {
		if (this.socket.destroyed) return;
		const length = payload.length;
		let header;
		if (length < 126) {
			header = Buffer.alloc(2);
			header[0] = 128 | opcode;
			header[1] = length;
		} else if (length < 65536) {
			header = Buffer.alloc(4);
			header[0] = 128 | opcode;
			header[1] = 126;
			header.writeUInt16BE(length, 2);
		} else {
			header = Buffer.alloc(10);
			header[0] = 128 | opcode;
			header[1] = 127;
			header.writeUInt32BE(0, 2);
			header.writeUInt32BE(length, 6);
		}
		try {
			this.socket.write(Buffer.concat([header, payload]));
		} catch (err) {
			if (!this.socket.destroyed) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`[LLMock] Unexpected writeFrame error: ${msg}`);
			}
		}
	}
	parseFrames() {
		while (this.buffer.length >= 2 && !this.closed) {
			const byte0 = this.buffer[0];
			const byte1 = this.buffer[1];
			const fin = (byte0 & 128) !== 0;
			const opcode = byte0 & 15;
			const masked = (byte1 & 128) !== 0;
			let payloadLength = byte1 & 127;
			let offset = 2;
			if (payloadLength === 126) {
				if (this.buffer.length < 4) return;
				payloadLength = this.buffer.readUInt16BE(2);
				offset = 4;
			} else if (payloadLength === 127) {
				if (this.buffer.length < 10) return;
				payloadLength = this.buffer.readUInt32BE(6) + this.buffer.readUInt32BE(2) * 4294967296;
				offset = 10;
			}
			const totalFrameSize = offset + (masked ? 4 : 0) + payloadLength;
			if (this.buffer.length < totalFrameSize) return;
			let maskKey = null;
			if (masked) {
				maskKey = this.buffer.subarray(offset, offset + 4);
				offset += 4;
			}
			let payload = this.buffer.subarray(offset, offset + payloadLength);
			if (maskKey) {
				payload = Buffer.from(payload);
				for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
			}
			this.buffer = this.buffer.subarray(totalFrameSize);
			this.handleFrame(fin, opcode, payload);
		}
	}
	handleFrame(fin, opcode, payload) {
		if (opcode === OP_PING) {
			this.writeFrame(OP_PONG, payload);
			return;
		}
		if (opcode === OP_PONG) return;
		if (opcode === OP_CLOSE) {
			const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
			const reason = payload.length > 2 ? payload.subarray(2).toString("utf-8") : "";
			if (!this.closed) {
				this.closed = true;
				this.writeFrame(OP_CLOSE, payload);
				this.socket.end();
				this.emit("close", code, reason);
			}
			return;
		}
		if (opcode === OP_TEXT || opcode === OP_CONTINUATION) {
			this.fragments.push(payload);
			if (fin) {
				const message = Buffer.concat(this.fragments).toString("utf-8");
				this.fragments = [];
				this.emit("message", message);
			}
			return;
		}
	}
};
function computeAcceptKey(wsKey) {
	return (0, node_crypto.createHash)("sha1").update(wsKey + WS_GUID).digest("base64");
}
function upgradeToWebSocket(req, socket) {
	const key = req.headers["sec-websocket-key"];
	if (!key) {
		socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
		socket.destroy();
		throw new Error("Missing Sec-WebSocket-Key header");
	}
	let responseHeaders = `HTTP/1.1 101 Switching Protocols\r
Upgrade: websocket\r
Connection: Upgrade\r
Sec-WebSocket-Accept: ${computeAcceptKey(key)}\r\n`;
	const protocol = req.headers["sec-websocket-protocol"];
	if (protocol) {
		const first = protocol.split(",")[0].trim();
		responseHeaders += `Sec-WebSocket-Protocol: ${first}\r\n`;
	}
	responseHeaders += "\r\n";
	socket.write(responseHeaders);
	return new WebSocketConnection(socket);
}

//#endregion
exports.WebSocketConnection = WebSocketConnection;
exports.computeAcceptKey = computeAcceptKey;
exports.upgradeToWebSocket = upgradeToWebSocket;
//# sourceMappingURL=ws-framing.cjs.map