import { isErrorResponse, isTextResponse, isToolCallResponse } from "./helpers.js";
import { matchFixture } from "./router.js";
import { delay } from "./sse-writer.js";
import { createInterruptionSignal } from "./interruption.js";
import { buildTextStreamEvents, buildToolCallStreamEvents, responsesToCompletionRequest } from "./responses.js";

//#region src/ws-responses.ts
function isResponseCreateMessage(msg) {
	return typeof msg === "object" && msg !== null && msg.type === "response.create";
}
function buildErrorEvent(message, type = "invalid_request_error", code) {
	return {
		type: "error",
		error: {
			message,
			type,
			code
		}
	};
}
function handleWebSocketResponses(ws, fixtures, journal, defaults) {
	const { logger } = defaults;
	let pending = Promise.resolve();
	ws.on("message", (raw) => {
		pending = pending.then(() => processMessage(raw, ws, fixtures, journal, defaults).catch((err) => {
			const msg = err instanceof Error ? err.message : "Internal error";
			logger.error(`WebSocket responses error: ${msg}`);
			try {
				ws.send(JSON.stringify(buildErrorEvent(msg, "server_error")));
			} catch {}
		}));
	});
}
async function processMessage(raw, ws, fixtures, journal, defaults) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		ws.send(JSON.stringify(buildErrorEvent("Malformed JSON", "invalid_request_error", "invalid_json")));
		return;
	}
	if (!isResponseCreateMessage(parsed)) {
		ws.send(JSON.stringify(buildErrorEvent("Expected message type \"response.create\"", "invalid_request_error", "invalid_message_type")));
		return;
	}
	const completionReq = responsesToCompletionRequest({
		model: parsed.model ?? defaults.model,
		input: parsed.input ?? [],
		instructions: parsed.instructions,
		tools: parsed.tools,
		tool_choice: parsed.tool_choice,
		stream: parsed.stream,
		temperature: parsed.temperature,
		max_output_tokens: parsed.max_output_tokens
	});
	const fixture = matchFixture(fixtures, completionReq, journal.fixtureMatchCounts, defaults.requestTransform);
	if (fixture) journal.incrementFixtureMatchCount(fixture, fixtures);
	if (!fixture) {
		if (defaults.strict) {
			defaults.logger.warn(`STRICT: No fixture matched for WebSocket message`);
			ws.close(1008, "Strict mode: no fixture matched");
			return;
		}
		journal.add({
			method: "WS",
			path: "/v1/responses",
			headers: {},
			body: completionReq,
			response: {
				status: 404,
				fixture: null
			}
		});
		ws.send(JSON.stringify(buildErrorEvent("No fixture matched", "invalid_request_error", "no_fixture_match")));
		return;
	}
	const response = fixture.response;
	const latency = fixture.latency ?? defaults.latency;
	const chunkSize = Math.max(1, fixture.chunkSize ?? defaults.chunkSize);
	if (isErrorResponse(response)) {
		const status = response.status ?? 500;
		journal.add({
			method: "WS",
			path: "/v1/responses",
			headers: {},
			body: completionReq,
			response: {
				status,
				fixture
			}
		});
		ws.send(JSON.stringify(buildErrorEvent(response.error.message, response.error.type, response.error.code)));
		return;
	}
	if (isTextResponse(response)) {
		const journalEntry = journal.add({
			method: "WS",
			path: "/v1/responses",
			headers: {},
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		const events = buildTextStreamEvents(response.content, completionReq.model, chunkSize);
		const interruption = createInterruptionSignal(fixture);
		if (!await sendEvents(ws, events, latency, interruption?.signal, interruption?.tick)) {
			ws.destroy();
			journalEntry.response.interrupted = true;
			journalEntry.response.interruptReason = interruption?.reason();
		}
		interruption?.cleanup();
		return;
	}
	if (isToolCallResponse(response)) {
		const journalEntry = journal.add({
			method: "WS",
			path: "/v1/responses",
			headers: {},
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		const events = buildToolCallStreamEvents(response.toolCalls, completionReq.model, chunkSize);
		const interruption = createInterruptionSignal(fixture);
		if (!await sendEvents(ws, events, latency, interruption?.signal, interruption?.tick)) {
			ws.destroy();
			journalEntry.response.interrupted = true;
			journalEntry.response.interruptReason = interruption?.reason();
		}
		interruption?.cleanup();
		return;
	}
	journal.add({
		method: "WS",
		path: "/v1/responses",
		headers: {},
		body: completionReq,
		response: {
			status: 500,
			fixture
		}
	});
	ws.send(JSON.stringify(buildErrorEvent("Fixture response did not match any known type", "server_error")));
}
async function sendEvents(ws, events, latency, signal, onChunkSent) {
	for (const event of events) {
		if (ws.isClosed) return true;
		if (latency > 0) await delay(latency, signal);
		if (signal?.aborted) return false;
		if (ws.isClosed) return true;
		ws.send(JSON.stringify(event));
		onChunkSent?.();
		if (signal?.aborted) return false;
	}
	return true;
}

//#endregion
export { handleWebSocketResponses };
//# sourceMappingURL=ws-responses.js.map