import { generateId, generateToolCallId, isErrorResponse, isTextResponse, isToolCallResponse } from "./helpers.js";
import { matchFixture } from "./router.js";
import { delay } from "./sse-writer.js";
import { createInterruptionSignal } from "./interruption.js";

//#region src/ws-realtime.ts
function realtimeItemsToMessages(items, instructions, logger) {
	const messages = [];
	if (instructions) messages.push({
		role: "system",
		content: instructions
	});
	for (const item of items) if (item.type === "message") {
		const text = item.content?.[0]?.text ?? "";
		const role = item.role === "assistant" ? "assistant" : item.role === "system" ? "system" : "user";
		messages.push({
			role,
			content: text
		});
	} else if (item.type === "function_call") {
		if (!item.name) logger?.warn("Realtime function_call item missing 'name'");
		messages.push({
			role: "assistant",
			content: null,
			tool_calls: [{
				id: item.call_id ?? generateToolCallId(),
				type: "function",
				function: {
					name: item.name ?? "",
					arguments: item.arguments ?? ""
				}
			}]
		});
	} else if (item.type === "function_call_output") {
		if (!item.output) logger?.warn("Realtime function_call_output item missing 'output'");
		messages.push({
			role: "tool",
			content: item.output ?? "",
			tool_call_id: item.call_id
		});
	}
	return messages;
}
function evt(type, extra = {}) {
	return JSON.stringify({
		type,
		event_id: generateId("evt"),
		...extra
	});
}
function buildErrorRealtimeEvent(message, type = "invalid_request_error", code) {
	return evt("error", { error: {
		message,
		type,
		code
	} });
}
function handleWebSocketRealtime(ws, fixtures, journal, defaults) {
	const { logger } = defaults;
	const sessionId = generateId("sess");
	const session = {
		model: defaults.model,
		modalities: ["text"],
		instructions: "",
		tools: [],
		voice: null,
		input_audio_format: null,
		output_audio_format: null,
		turn_detection: null,
		temperature: .8
	};
	const conversationItems = [];
	ws.send(evt("session.created", { session: {
		id: sessionId,
		...session
	} }));
	let pending = Promise.resolve();
	ws.on("message", (raw) => {
		pending = pending.then(() => processMessage(raw, ws, fixtures, journal, defaults, session, conversationItems).catch((err) => {
			const msg = err instanceof Error ? err.message : "Internal error";
			logger.error(`WebSocket realtime error: ${msg}`);
			try {
				ws.send(buildErrorRealtimeEvent(msg, "server_error"));
			} catch {}
		}));
	});
}
async function processMessage(raw, ws, fixtures, journal, defaults, session, conversationItems) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		ws.send(buildErrorRealtimeEvent("Malformed JSON", "invalid_request_error", "invalid_json"));
		return;
	}
	const msgType = parsed.type;
	if (msgType === "session.update") {
		if (parsed.session) {
			if (parsed.session.instructions !== void 0) session.instructions = parsed.session.instructions;
			if (parsed.session.tools !== void 0) session.tools = parsed.session.tools;
			if (parsed.session.modalities !== void 0) session.modalities = parsed.session.modalities;
			if (parsed.session.model !== void 0) session.model = parsed.session.model;
			if (parsed.session.temperature !== void 0) session.temperature = parsed.session.temperature;
		}
		ws.send(evt("session.updated", { session: { ...session } }));
		return;
	}
	if (msgType === "conversation.item.create") {
		if (!parsed.item) {
			ws.send(buildErrorRealtimeEvent("Missing 'item' in conversation.item.create", "invalid_request_error"));
			return;
		}
		const item = parsed.item;
		if (!item.id) item.id = generateId("item");
		conversationItems.push(item);
		ws.send(evt("conversation.item.created", { item }));
		return;
	}
	if (msgType === "response.create") {
		await handleResponseCreate(ws, fixtures, journal, defaults, session, conversationItems);
		return;
	}
}
async function handleResponseCreate(ws, fixtures, journal, defaults, session, conversationItems) {
	const messages = realtimeItemsToMessages(conversationItems, session.instructions || void 0, defaults.logger);
	const completionReq = {
		model: session.model,
		messages
	};
	const fixture = matchFixture(fixtures, completionReq, journal.fixtureMatchCounts, defaults.requestTransform);
	const responseId = generateId("resp");
	if (fixture) journal.incrementFixtureMatchCount(fixture, fixtures);
	if (!fixture) {
		if (defaults.strict) {
			defaults.logger.warn(`STRICT: No fixture matched for WebSocket message`);
			ws.close(1008, "Strict mode: no fixture matched");
			return;
		}
		journal.add({
			method: "WS",
			path: "/v1/realtime",
			headers: {},
			body: completionReq,
			response: {
				status: 404,
				fixture: null
			}
		});
		ws.send(evt("response.created", { response: {
			id: responseId,
			status: "failed",
			output: []
		} }));
		ws.send(evt("response.done", { response: {
			id: responseId,
			status: "failed",
			output: [],
			status_details: {
				type: "error",
				error: {
					message: "No fixture matched",
					type: "invalid_request_error",
					code: "no_fixture_match"
				}
			}
		} }));
		return;
	}
	const response = fixture.response;
	const latency = fixture.latency ?? defaults.latency;
	const chunkSize = Math.max(1, fixture.chunkSize ?? defaults.chunkSize);
	if (isErrorResponse(response)) {
		const status = response.status ?? 500;
		journal.add({
			method: "WS",
			path: "/v1/realtime",
			headers: {},
			body: completionReq,
			response: {
				status,
				fixture
			}
		});
		ws.send(evt("response.created", { response: {
			id: responseId,
			status: "failed",
			output: []
		} }));
		ws.send(evt("response.done", { response: {
			id: responseId,
			status: "failed",
			output: [],
			status_details: {
				type: "error",
				error: {
					message: response.error.message,
					type: response.error.type,
					code: response.error.code
				}
			}
		} }));
		return;
	}
	if (isTextResponse(response)) {
		const journalEntry = journal.add({
			method: "WS",
			path: "/v1/realtime",
			headers: {},
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		const itemId = generateId("item");
		const contentIndex = 0;
		const outputIndex = 0;
		const outputItem = {
			id: itemId,
			type: "message",
			role: "assistant",
			content: [{
				type: "text",
				text: response.content
			}]
		};
		ws.send(evt("response.created", { response: {
			id: responseId,
			status: "in_progress",
			output: []
		} }));
		ws.send(evt("response.output_item.added", {
			response_id: responseId,
			output_index: outputIndex,
			item: {
				id: itemId,
				type: "message",
				role: "assistant",
				content: []
			}
		}));
		ws.send(evt("response.content_part.added", {
			response_id: responseId,
			item_id: itemId,
			output_index: outputIndex,
			content_index: contentIndex,
			part: {
				type: "text",
				text: ""
			}
		}));
		const content = response.content;
		const interruption = createInterruptionSignal(fixture);
		let interrupted = false;
		for (let i = 0; i < content.length; i += chunkSize) {
			if (ws.isClosed) break;
			if (latency > 0) await delay(latency, interruption?.signal);
			if (interruption?.signal.aborted) {
				interrupted = true;
				break;
			}
			if (ws.isClosed) break;
			const chunk = content.slice(i, i + chunkSize);
			ws.send(evt("response.text.delta", {
				response_id: responseId,
				item_id: itemId,
				output_index: outputIndex,
				content_index: contentIndex,
				delta: chunk
			}));
			interruption?.tick();
			if (interruption?.signal.aborted) {
				interrupted = true;
				break;
			}
		}
		if (interrupted) {
			ws.destroy();
			journalEntry.response.interrupted = true;
			journalEntry.response.interruptReason = interruption?.reason();
			interruption?.cleanup();
			return;
		}
		interruption?.cleanup();
		if (ws.isClosed) return;
		ws.send(evt("response.text.done", {
			response_id: responseId,
			item_id: itemId,
			output_index: outputIndex,
			content_index: contentIndex,
			text: content
		}));
		ws.send(evt("response.content_part.done", {
			response_id: responseId,
			item_id: itemId,
			output_index: outputIndex,
			content_index: contentIndex,
			part: {
				type: "text",
				text: content
			}
		}));
		ws.send(evt("response.output_item.done", {
			response_id: responseId,
			output_index: outputIndex,
			item: outputItem
		}));
		ws.send(evt("response.done", { response: {
			id: responseId,
			status: "completed",
			output: [outputItem]
		} }));
		conversationItems.push({
			type: "message",
			id: itemId,
			role: "assistant",
			content: [{
				type: "text",
				text: content
			}]
		});
		return;
	}
	if (isToolCallResponse(response)) {
		const journalEntry = journal.add({
			method: "WS",
			path: "/v1/realtime",
			headers: {},
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		ws.send(evt("response.created", { response: {
			id: responseId,
			status: "in_progress",
			output: []
		} }));
		const outputItems = [];
		const interruption = createInterruptionSignal(fixture);
		let interrupted = false;
		for (let tcIdx = 0; tcIdx < response.toolCalls.length; tcIdx++) {
			const tc = response.toolCalls[tcIdx];
			const callId = tc.id ?? generateToolCallId();
			const itemId = generateId("item");
			const outputItem = {
				id: itemId,
				type: "function_call",
				call_id: callId,
				name: tc.name,
				arguments: tc.arguments
			};
			ws.send(evt("response.output_item.added", {
				response_id: responseId,
				output_index: tcIdx,
				item: {
					id: itemId,
					type: "function_call",
					call_id: callId,
					name: tc.name,
					arguments: ""
				}
			}));
			const args = tc.arguments;
			for (let i = 0; i < args.length; i += chunkSize) {
				if (ws.isClosed) break;
				if (latency > 0) await delay(latency, interruption?.signal);
				if (interruption?.signal.aborted) {
					interrupted = true;
					break;
				}
				if (ws.isClosed) break;
				const chunk = args.slice(i, i + chunkSize);
				ws.send(evt("response.function_call_arguments.delta", {
					response_id: responseId,
					item_id: itemId,
					output_index: tcIdx,
					call_id: callId,
					delta: chunk
				}));
				interruption?.tick();
				if (interruption?.signal.aborted) {
					interrupted = true;
					break;
				}
			}
			if (interrupted) break;
			ws.send(evt("response.function_call_arguments.done", {
				response_id: responseId,
				item_id: itemId,
				output_index: tcIdx,
				call_id: callId,
				arguments: args
			}));
			ws.send(evt("response.output_item.done", {
				response_id: responseId,
				output_index: tcIdx,
				item: outputItem
			}));
			outputItems.push(outputItem);
		}
		if (interrupted) {
			ws.destroy();
			journalEntry.response.interrupted = true;
			journalEntry.response.interruptReason = interruption?.reason();
			interruption?.cleanup();
			return;
		}
		interruption?.cleanup();
		if (ws.isClosed) return;
		ws.send(evt("response.done", { response: {
			id: responseId,
			status: "completed",
			output: outputItems
		} }));
		for (const item of outputItems) conversationItems.push(item);
		return;
	}
	journal.add({
		method: "WS",
		path: "/v1/realtime",
		headers: {},
		body: completionReq,
		response: {
			status: 500,
			fixture
		}
	});
	ws.send(buildErrorRealtimeEvent("Fixture response did not match any known type", "server_error"));
}

//#endregion
export { handleWebSocketRealtime };
//# sourceMappingURL=ws-realtime.js.map