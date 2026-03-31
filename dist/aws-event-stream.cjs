const require_runtime = require('./_virtual/_rolldown/runtime.cjs');
const require_sse_writer = require('./sse-writer.cjs');
let node_zlib = require("node:zlib");

//#region src/aws-event-stream.ts
/**
* AWS Event Stream binary frame encoder.
*
* Implements the AWS binary event stream framing protocol used by Bedrock's
* streaming (invoke-with-response-stream) endpoint. Each frame carries a set of
* string headers and a raw-bytes payload, wrapped in a prelude with CRC32
* checksums for integrity.
*
* Binary frame layout:
*   [total_length: 4B uint32-BE]
*   [headers_length: 4B uint32-BE]
*   [prelude_crc32: 4B CRC32 of first 8 bytes]
*   [headers: variable]
*   [payload: variable, raw JSON bytes]
*   [message_crc32: 4B CRC32 of entire frame minus last 4 bytes]
*/
function encodeHeaders(headers) {
	const parts = [];
	for (const [name, value] of Object.entries(headers)) {
		const nameBytes = Buffer.from(name, "utf8");
		const valueBytes = Buffer.from(value, "utf8");
		const header = Buffer.alloc(1 + nameBytes.length + 1 + 2 + valueBytes.length);
		let offset = 0;
		header.writeUInt8(nameBytes.length, offset);
		offset += 1;
		nameBytes.copy(header, offset);
		offset += nameBytes.length;
		header.writeUInt8(7, offset);
		offset += 1;
		header.writeUInt16BE(valueBytes.length, offset);
		offset += 2;
		valueBytes.copy(header, offset);
		parts.push(header);
	}
	return Buffer.concat(parts);
}
/**
* Encode a single AWS Event Stream binary frame with the given headers and
* payload buffer.
*/
function encodeEventStreamFrame(headers, payload) {
	const headersBuffer = encodeHeaders(headers);
	const headersLength = headersBuffer.length;
	const totalLength = 12 + headersLength + payload.length + 4;
	const frame = Buffer.alloc(totalLength);
	let offset = 0;
	frame.writeUInt32BE(totalLength, offset);
	offset += 4;
	frame.writeUInt32BE(headersLength, offset);
	offset += 4;
	const preludeCrc = (0, node_zlib.crc32)(frame.subarray(0, 8));
	frame.writeUInt32BE(preludeCrc >>> 0, offset);
	offset += 4;
	headersBuffer.copy(frame, offset);
	offset += headersLength;
	payload.copy(frame, offset);
	offset += payload.length;
	const messageCrc = (0, node_zlib.crc32)(frame.subarray(0, totalLength - 4));
	frame.writeUInt32BE(messageCrc >>> 0, offset);
	return frame;
}
/**
* Encode an event-stream message with standard AWS headers for a JSON event.
*
* Sets `:content-type` = `application/json`, `:event-type` = eventType,
* `:message-type` = `event`.
*/
function encodeEventStreamMessage(eventType, jsonPayload) {
	return encodeEventStreamFrame({
		":content-type": "application/json",
		":event-type": eventType,
		":message-type": "event"
	}, Buffer.from(JSON.stringify(jsonPayload), "utf8"));
}
/**
* Write a sequence of event-stream frames to an HTTP response with optional
* timing control. Mirrors the writeSSEStream pattern from sse-writer.ts.
*
* Returns `true` when all events are written (including when the response
* was already ended before writing began), or `false` if interrupted by
* the provided abort signal.
*/
async function writeEventStream(res, events, options) {
	const opts = options ?? {};
	const latency = opts.latency ?? 0;
	const profile = opts.streamingProfile;
	const signal = opts.signal;
	const onChunkSent = opts.onChunkSent;
	if (res.writableEnded) return true;
	res.setHeader("Content-Type", "application/vnd.amazon.eventstream");
	res.setHeader("Transfer-Encoding", "chunked");
	let chunkIndex = 0;
	for (const event of events) {
		const chunkDelay = require_sse_writer.calculateDelay(chunkIndex, profile, latency);
		if (chunkDelay > 0) await require_sse_writer.delay(chunkDelay, signal);
		if (signal?.aborted) return false;
		if (res.writableEnded) return true;
		const frame = encodeEventStreamMessage(event.eventType, event.payload);
		res.write(frame);
		onChunkSent?.();
		if (signal?.aborted) return false;
		chunkIndex++;
	}
	if (!res.writableEnded) res.end();
	return true;
}

//#endregion
exports.encodeEventStreamFrame = encodeEventStreamFrame;
exports.encodeEventStreamMessage = encodeEventStreamMessage;
exports.writeEventStream = writeEventStream;
//# sourceMappingURL=aws-event-stream.cjs.map