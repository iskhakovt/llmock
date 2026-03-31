const require_runtime = require('./_virtual/_rolldown/runtime.cjs');
let node_zlib = require("node:zlib");

//#region src/stream-collapse.ts
/**
* Stream collapsing functions for record-and-replay.
*
* Each function takes a raw streaming response body (SSE, NDJSON, or binary
* EventStream) and collapses it into a non-streaming fixture response
* containing either `{ content }` or `{ toolCalls }`.
*/
/**
* Collapse OpenAI Chat Completions SSE stream into a single response.
*
* Format:
*   data: {"id":"chatcmpl-123","choices":[{"delta":{"content":"Hello"}}]}\n\n
*   data: [DONE]\n\n
*/
function collapseOpenAISSE(body) {
	const lines = body.split("\n\n").filter((l) => l.trim().length > 0);
	let content = "";
	let droppedChunks = 0;
	const toolCallMap = /* @__PURE__ */ new Map();
	for (const line of lines) {
		const dataLine = line.split("\n").find((l) => l.startsWith("data:"));
		if (!dataLine) continue;
		const payload = dataLine.slice(5).trim();
		if (payload === "[DONE]") continue;
		let parsed;
		try {
			parsed = JSON.parse(payload);
		} catch {
			droppedChunks++;
			continue;
		}
		const choices = parsed.choices;
		if (!choices || choices.length === 0) continue;
		const delta = choices[0].delta;
		if (!delta) continue;
		if (typeof delta.content === "string") content += delta.content;
		const toolCalls = delta.tool_calls;
		if (toolCalls) for (const tc of toolCalls) {
			const index = tc.index;
			const fn = tc.function;
			if (!toolCallMap.has(index)) toolCallMap.set(index, {
				id: tc.id ?? "",
				name: fn?.name ?? "",
				arguments: ""
			});
			const entry = toolCallMap.get(index);
			if (fn?.name && typeof fn.name === "string" && !entry.name) entry.name = fn.name;
			if (tc.id && typeof tc.id === "string" && !entry.id) entry.id = tc.id;
			if (fn?.arguments && typeof fn.arguments === "string") entry.arguments += fn.arguments;
		}
	}
	if (toolCallMap.size > 0) return {
		toolCalls: Array.from(toolCallMap.entries()).sort(([a], [b]) => a - b).map(([, tc]) => ({
			name: tc.name,
			arguments: tc.arguments,
			...tc.id ? { id: tc.id } : {}
		})),
		...droppedChunks > 0 ? { droppedChunks } : {}
	};
	return {
		content,
		...droppedChunks > 0 ? { droppedChunks } : {}
	};
}
/**
* Collapse Anthropic Claude Messages SSE stream into a single response.
*
* Format:
*   event: message_start\ndata: {...}\n\n
*   event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hello"}}\n\n
*/
function collapseAnthropicSSE(body) {
	const blocks = body.split("\n\n").filter((b) => b.trim().length > 0);
	let content = "";
	let droppedChunks = 0;
	const toolCallMap = /* @__PURE__ */ new Map();
	for (const block of blocks) {
		const lines = block.split("\n");
		const eventLine = lines.find((l) => l.startsWith("event:"));
		const dataLine = lines.find((l) => l.startsWith("data:"));
		if (!dataLine) continue;
		const eventType = eventLine ? eventLine.slice(6).trim() : "";
		const payload = dataLine.slice(5).trim();
		let parsed;
		try {
			parsed = JSON.parse(payload);
		} catch {
			droppedChunks++;
			continue;
		}
		if (eventType === "content_block_start") {
			const index = parsed.index;
			const contentBlock = parsed.content_block;
			if (contentBlock?.type === "tool_use") toolCallMap.set(index, {
				id: contentBlock.id ?? "",
				name: contentBlock.name ?? "",
				arguments: ""
			});
		}
		if (eventType === "content_block_delta") {
			const index = parsed.index;
			const delta = parsed.delta;
			if (!delta) continue;
			if (delta.type === "text_delta" && typeof delta.text === "string") content += delta.text;
			if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
				const entry = toolCallMap.get(index);
				if (entry) entry.arguments += delta.partial_json;
			}
		}
	}
	if (toolCallMap.size > 0) return {
		toolCalls: Array.from(toolCallMap.entries()).sort(([a], [b]) => a - b).map(([, tc]) => ({
			name: tc.name,
			arguments: tc.arguments,
			...tc.id ? { id: tc.id } : {}
		})),
		...droppedChunks > 0 ? { droppedChunks } : {}
	};
	return {
		content,
		...droppedChunks > 0 ? { droppedChunks } : {}
	};
}
/**
* Collapse Gemini SSE stream into a single response.
*
* Format (data-only, no event prefix, no [DONE]):
*   data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n
*/
function collapseGeminiSSE(body) {
	const lines = body.split("\n\n").filter((l) => l.trim().length > 0);
	let content = "";
	let droppedChunks = 0;
	for (const line of lines) {
		const dataLine = line.split("\n").find((l) => l.startsWith("data:"));
		if (!dataLine) continue;
		const payload = dataLine.slice(5).trim();
		let parsed;
		try {
			parsed = JSON.parse(payload);
		} catch {
			droppedChunks++;
			continue;
		}
		const candidates = parsed.candidates;
		if (!candidates || candidates.length === 0) continue;
		const candidateContent = candidates[0].content;
		if (!candidateContent) continue;
		const parts = candidateContent.parts;
		if (!parts || parts.length === 0) continue;
		const fnCallParts = parts.filter((p) => p.functionCall);
		if (fnCallParts.length > 0) {
			const toolCallMap = /* @__PURE__ */ new Map();
			for (let i = 0; i < fnCallParts.length; i++) {
				const fc = fnCallParts[i].functionCall;
				toolCallMap.set(i, {
					name: String(fc.name ?? ""),
					arguments: typeof fc.args === "string" ? fc.args : JSON.stringify(fc.args)
				});
			}
			if (toolCallMap.size > 0) return {
				toolCalls: Array.from(toolCallMap.entries()).sort(([a], [b]) => a - b).map(([, tc]) => ({
					name: tc.name,
					arguments: tc.arguments
				})),
				...droppedChunks > 0 ? { droppedChunks } : {}
			};
		}
		if (typeof parts[0].text === "string") content += parts[0].text;
	}
	return {
		content,
		...droppedChunks > 0 ? { droppedChunks } : {}
	};
}
/**
* Collapse Ollama NDJSON stream into a single response.
*
* /api/chat format:
*   {"model":"llama3","message":{"role":"assistant","content":"Hello"},"done":false}\n
*
* /api/generate format:
*   {"model":"llama3","response":"Hello","done":false}\n
*/
function collapseOllamaNDJSON(body) {
	const lines = body.split("\n").filter((l) => l.trim().length > 0);
	let content = "";
	let droppedChunks = 0;
	const toolCalls = [];
	for (const line of lines) {
		let parsed;
		try {
			parsed = JSON.parse(line.trim());
		} catch {
			droppedChunks++;
			continue;
		}
		const message = parsed.message;
		if (message) {
			if (typeof message.content === "string") content += message.content;
			if (Array.isArray(message.tool_calls)) for (const tc of message.tool_calls) {
				const fn = tc.function;
				if (fn) toolCalls.push({
					name: String(fn.name ?? ""),
					arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments)
				});
			}
		} else if (typeof parsed.response === "string") content += parsed.response;
	}
	if (toolCalls.length > 0) return {
		toolCalls,
		...droppedChunks > 0 ? { droppedChunks } : {}
	};
	return {
		content,
		...droppedChunks > 0 ? { droppedChunks } : {}
	};
}
/**
* Collapse Cohere SSE stream into a single response.
*
* Format:
*   event: content-delta\ndata: {"type":"content-delta","delta":{"message":{"content":{"text":"Hello"}}}}\n\n
*/
function collapseCohereSSE(body) {
	const blocks = body.split("\n\n").filter((b) => b.trim().length > 0);
	let content = "";
	let droppedChunks = 0;
	const toolCallMap = /* @__PURE__ */ new Map();
	for (const block of blocks) {
		const lines = block.split("\n");
		const eventLine = lines.find((l) => l.startsWith("event:"));
		const dataLine = lines.find((l) => l.startsWith("data:"));
		if (!dataLine) continue;
		const eventType = eventLine ? eventLine.slice(6).trim() : "";
		const payload = dataLine.slice(5).trim();
		let parsed;
		try {
			parsed = JSON.parse(payload);
		} catch {
			droppedChunks++;
			continue;
		}
		if (eventType === "content-delta") {
			const contentObj = (parsed.delta?.message)?.content;
			if (contentObj && typeof contentObj.text === "string") content += contentObj.text;
		}
		if (eventType === "tool-call-start") {
			const index = parsed.index;
			const toolCalls = (parsed.delta?.message)?.tool_calls;
			if (toolCalls) {
				const fn = toolCalls.function;
				toolCallMap.set(index, {
					id: toolCalls.id ?? "",
					name: fn?.name ?? "",
					arguments: ""
				});
			}
		}
		if (eventType === "tool-call-delta") {
			const index = parsed.index;
			const toolCalls = (parsed.delta?.message)?.tool_calls;
			if (toolCalls) {
				const fn = toolCalls.function;
				if (fn && typeof fn.arguments === "string") {
					const entry = toolCallMap.get(index);
					if (entry) entry.arguments += fn.arguments;
				}
			}
		}
	}
	if (toolCallMap.size > 0) return {
		toolCalls: Array.from(toolCallMap.entries()).sort(([a], [b]) => a - b).map(([, tc]) => ({
			name: tc.name,
			arguments: tc.arguments,
			...tc.id ? { id: tc.id } : {}
		})),
		...droppedChunks > 0 ? { droppedChunks } : {}
	};
	return {
		content,
		...droppedChunks > 0 ? { droppedChunks } : {}
	};
}
/**
* Decode AWS Event Stream binary frames and extract JSON payloads.
*
* Binary frame layout:
*   [total_length: 4B uint32-BE]
*   [headers_length: 4B uint32-BE]
*   [prelude_crc32: 4B]
*   [headers: variable]
*   [payload: variable]
*   [message_crc32: 4B]
*/
function decodeEventStreamFrames(buf) {
	const frames = [];
	let offset = 0;
	while (offset < buf.length) {
		if (offset + 12 > buf.length) break;
		const totalLength = buf.readUInt32BE(offset);
		const headersLength = buf.readUInt32BE(offset + 4);
		if (totalLength < 12 || offset + totalLength > buf.length) return {
			frames,
			truncated: true
		};
		const preludeCrc = buf.readUInt32BE(offset + 8);
		const computedPreludeCrc = (0, node_zlib.crc32)(buf.subarray(offset, offset + 8));
		if (preludeCrc >>> 0 !== computedPreludeCrc >>> 0) return {
			frames,
			truncated: true
		};
		const headersStart = offset + 12;
		const headersEnd = headersStart + headersLength;
		const headers = {};
		let hOffset = headersStart;
		while (hOffset < headersEnd) {
			const nameLen = buf.readUInt8(hOffset);
			hOffset += 1;
			const name = buf.subarray(hOffset, hOffset + nameLen).toString("utf8");
			hOffset += nameLen;
			hOffset += 1;
			const valueLen = buf.readUInt16BE(hOffset);
			hOffset += 2;
			const value = buf.subarray(hOffset, hOffset + valueLen).toString("utf8");
			hOffset += valueLen;
			headers[name] = value;
		}
		const payloadStart = headersEnd;
		const payloadEnd = offset + totalLength - 4;
		const payload = buf.subarray(payloadStart, payloadEnd);
		const messageCrc = buf.readUInt32BE(offset + totalLength - 4);
		const computedMessageCrc = (0, node_zlib.crc32)(buf.subarray(offset, offset + totalLength - 4));
		if (messageCrc >>> 0 !== computedMessageCrc >>> 0) return {
			frames,
			truncated: true
		};
		frames.push({
			headers,
			payload
		});
		offset += totalLength;
	}
	return {
		frames,
		truncated: false
	};
}
/**
* Collapse Bedrock binary Event Stream into a single response.
*
* Each frame contains a JSON payload with event types like:
*   contentBlockDelta, contentBlockStart, etc.
*/
function collapseBedrockEventStream(body) {
	const { frames, truncated } = decodeEventStreamFrames(body);
	let content = "";
	let droppedChunks = 0;
	const toolCallMap = /* @__PURE__ */ new Map();
	for (const frame of frames) {
		let parsed;
		try {
			parsed = JSON.parse(frame.payload.toString("utf8"));
		} catch {
			droppedChunks++;
			continue;
		}
		if (parsed.type === "content_block_delta") {
			const delta = parsed.delta;
			if (delta?.type === "text_delta" && typeof delta.text === "string") content += delta.text;
			if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
				const index = parsed.index;
				if (index !== void 0) {
					const entry = toolCallMap.get(index);
					if (entry) entry.arguments += delta.partial_json;
				}
			}
			continue;
		}
		if (parsed.type === "content_block_start") {
			const block = parsed.content_block;
			const index = parsed.index;
			if (block?.type === "tool_use" && index !== void 0) toolCallMap.set(index, {
				id: block.id ?? "",
				name: block.name ?? "",
				arguments: ""
			});
			continue;
		}
		if (parsed.contentBlockStart) {
			const blockStart = parsed.contentBlockStart;
			const index = parsed.contentBlockIndex ?? blockStart.contentBlockIndex;
			const start = blockStart.start;
			if (start?.toolUse && index !== void 0) {
				const toolUse = start.toolUse;
				toolCallMap.set(index, {
					id: toolUse.toolUseId ?? "",
					name: toolUse.name ?? "",
					arguments: ""
				});
			}
		}
		if (parsed.contentBlockDelta) {
			const blockDelta = parsed.contentBlockDelta;
			const index = parsed.contentBlockIndex ?? blockDelta.contentBlockIndex;
			const delta = blockDelta.delta;
			if (!delta) continue;
			if (typeof delta.text === "string") content += delta.text;
			if (typeof delta.toolUse === "object" && delta.toolUse !== null) {
				const toolUseDelta = delta.toolUse;
				if (typeof toolUseDelta.input === "string" && index !== void 0) {
					const entry = toolCallMap.get(index);
					if (entry) entry.arguments += toolUseDelta.input;
				}
			}
		}
	}
	if (toolCallMap.size > 0) return {
		toolCalls: Array.from(toolCallMap.entries()).sort(([a], [b]) => a - b).map(([, tc]) => ({
			name: tc.name,
			arguments: tc.arguments,
			...tc.id ? { id: tc.id } : {}
		})),
		...droppedChunks > 0 ? { droppedChunks } : {},
		...truncated ? { truncated } : {}
	};
	return {
		content,
		...droppedChunks > 0 ? { droppedChunks } : {},
		...truncated ? { truncated } : {}
	};
}
/**
* Collapse a streaming response body into a non-streaming fixture response.
* Returns null if the content type is not a known streaming format.
* Falls back to OpenAI SSE parsing for unrecognized provider keys with text/event-stream.
*/
function collapseStreamingResponse(contentType, providerKey, body, logger) {
	const ct = contentType.toLowerCase();
	if (ct.includes("application/vnd.amazon.eventstream")) return collapseBedrockEventStream(typeof body === "string" ? Buffer.from(body, "binary") : body);
	if (ct.includes("application/x-ndjson")) return collapseOllamaNDJSON(typeof body === "string" ? body : body.toString("utf8"));
	if (ct.includes("text/event-stream")) {
		const str = typeof body === "string" ? body : body.toString("utf8");
		switch (providerKey) {
			case "openai":
			case "azure": return collapseOpenAISSE(str);
			case "anthropic": return collapseAnthropicSSE(str);
			case "gemini":
			case "vertexai": return collapseGeminiSSE(str);
			case "cohere": return collapseCohereSSE(str);
			case "bedrock": return collapseAnthropicSSE(str);
			default:
				logger?.warn(`[stream-collapse] unknown SSE provider "${providerKey}", falling back to OpenAI SSE format`);
				return collapseOpenAISSE(str);
		}
	}
	return null;
}

//#endregion
exports.collapseAnthropicSSE = collapseAnthropicSSE;
exports.collapseBedrockEventStream = collapseBedrockEventStream;
exports.collapseCohereSSE = collapseCohereSSE;
exports.collapseGeminiSSE = collapseGeminiSSE;
exports.collapseOllamaNDJSON = collapseOllamaNDJSON;
exports.collapseOpenAISSE = collapseOpenAISSE;
exports.collapseStreamingResponse = collapseStreamingResponse;
//# sourceMappingURL=stream-collapse.cjs.map