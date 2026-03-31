const require_helpers = require('./helpers.cjs');
const require_router = require('./router.cjs');
const require_sse_writer = require('./sse-writer.cjs');
const require_interruption = require('./interruption.cjs');
const require_chaos = require('./chaos.cjs');
const require_recorder = require('./recorder.cjs');

//#region src/cohere.ts
const ZERO_USAGE = {
	billed_units: {
		input_tokens: 0,
		output_tokens: 0,
		search_units: 0,
		classifications: 0
	},
	tokens: {
		input_tokens: 0,
		output_tokens: 0
	}
};
function cohereToCompletionRequest(req) {
	const messages = [];
	for (const msg of req.messages) if (msg.role === "system") messages.push({
		role: "system",
		content: msg.content
	});
	else if (msg.role === "user") messages.push({
		role: "user",
		content: msg.content
	});
	else if (msg.role === "assistant") messages.push({
		role: "assistant",
		content: msg.content
	});
	else if (msg.role === "tool") messages.push({
		role: "tool",
		content: msg.content,
		tool_call_id: msg.tool_call_id
	});
	let tools;
	if (req.tools && req.tools.length > 0) tools = req.tools.map((t) => ({
		type: "function",
		function: {
			name: t.function.name,
			description: t.function.description,
			parameters: t.function.parameters
		}
	}));
	return {
		model: req.model,
		messages,
		stream: req.stream,
		tools
	};
}
function buildCohereTextResponse(content) {
	return {
		id: require_helpers.generateMessageId(),
		finish_reason: "COMPLETE",
		message: {
			role: "assistant",
			content: [{
				type: "text",
				text: content
			}],
			tool_calls: [],
			tool_plan: "",
			citations: []
		},
		usage: ZERO_USAGE
	};
}
function buildCohereToolCallResponse(toolCalls, logger) {
	const cohereCalls = toolCalls.map((tc) => {
		try {
			JSON.parse(tc.arguments || "{}");
		} catch {
			logger.warn(`Malformed JSON in fixture tool call arguments for "${tc.name}": ${tc.arguments}`);
		}
		return {
			id: tc.id || require_helpers.generateToolCallId(),
			type: "function",
			function: {
				name: tc.name,
				arguments: tc.arguments || "{}"
			}
		};
	});
	return {
		id: require_helpers.generateMessageId(),
		finish_reason: "TOOL_CALL",
		message: {
			role: "assistant",
			content: [],
			tool_calls: cohereCalls,
			tool_plan: "",
			citations: []
		},
		usage: ZERO_USAGE
	};
}
function buildCohereTextStreamEvents(content, chunkSize) {
	const msgId = require_helpers.generateMessageId();
	const events = [];
	events.push({
		id: msgId,
		type: "message-start",
		delta: { message: {
			role: "assistant",
			content: [],
			tool_plan: "",
			tool_calls: [],
			citations: []
		} }
	});
	events.push({
		type: "content-start",
		index: 0,
		delta: { message: { content: { type: "text" } } }
	});
	for (let i = 0; i < content.length; i += chunkSize) {
		const slice = content.slice(i, i + chunkSize);
		events.push({
			type: "content-delta",
			index: 0,
			delta: { message: { content: {
				type: "text",
				text: slice
			} } }
		});
	}
	events.push({
		type: "content-end",
		index: 0
	});
	events.push({
		type: "message-end",
		delta: {
			finish_reason: "COMPLETE",
			usage: ZERO_USAGE
		}
	});
	return events;
}
function buildCohereToolCallStreamEvents(toolCalls, chunkSize, logger) {
	const msgId = require_helpers.generateMessageId();
	const events = [];
	events.push({
		id: msgId,
		type: "message-start",
		delta: { message: {
			role: "assistant",
			content: [],
			tool_plan: "",
			tool_calls: [],
			citations: []
		} }
	});
	events.push({
		type: "tool-plan-delta",
		delta: { message: { tool_plan: "I will use the requested tool." } }
	});
	for (let idx = 0; idx < toolCalls.length; idx++) {
		const tc = toolCalls[idx];
		const callId = tc.id || require_helpers.generateToolCallId();
		let argsJson;
		try {
			JSON.parse(tc.arguments || "{}");
			argsJson = tc.arguments || "{}";
		} catch {
			logger.warn(`Malformed JSON in fixture tool call arguments for "${tc.name}": ${tc.arguments}`);
			argsJson = "{}";
		}
		events.push({
			type: "tool-call-start",
			index: idx,
			delta: { message: { tool_calls: {
				id: callId,
				type: "function",
				function: {
					name: tc.name,
					arguments: ""
				}
			} } }
		});
		for (let i = 0; i < argsJson.length; i += chunkSize) {
			const slice = argsJson.slice(i, i + chunkSize);
			events.push({
				type: "tool-call-delta",
				index: idx,
				delta: { message: { tool_calls: { function: { arguments: slice } } } }
			});
		}
		events.push({
			type: "tool-call-end",
			index: idx
		});
	}
	events.push({
		type: "message-end",
		delta: {
			finish_reason: "TOOL_CALL",
			usage: ZERO_USAGE
		}
	});
	return events;
}
async function writeCohereSSEStream(res, events, optionsOrLatency) {
	const opts = typeof optionsOrLatency === "number" ? { latency: optionsOrLatency } : optionsOrLatency ?? {};
	const latency = opts.latency ?? 0;
	const profile = opts.streamingProfile;
	const signal = opts.signal;
	const onChunkSent = opts.onChunkSent;
	if (res.writableEnded) return true;
	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	let chunkIndex = 0;
	for (const event of events) {
		const chunkDelay = require_sse_writer.calculateDelay(chunkIndex, profile, latency);
		if (chunkDelay > 0) await require_sse_writer.delay(chunkDelay, signal);
		if (signal?.aborted) return false;
		if (res.writableEnded) return true;
		res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
		onChunkSent?.();
		if (signal?.aborted) return false;
		chunkIndex++;
	}
	if (!res.writableEnded) res.end();
	return true;
}
async function handleCohere(req, res, raw, fixtures, journal, defaults, setCorsHeaders) {
	const { logger } = defaults;
	setCorsHeaders(res);
	let cohereReq;
	try {
		cohereReq = JSON.parse(raw);
	} catch {
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v2/chat",
			headers: require_helpers.flattenHeaders(req.headers),
			body: null,
			response: {
				status: 400,
				fixture: null
			}
		});
		require_sse_writer.writeErrorResponse(res, 400, JSON.stringify({ error: {
			message: "Malformed JSON",
			type: "invalid_request_error"
		} }));
		return;
	}
	if (!cohereReq.model) {
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v2/chat",
			headers: require_helpers.flattenHeaders(req.headers),
			body: null,
			response: {
				status: 400,
				fixture: null
			}
		});
		require_sse_writer.writeErrorResponse(res, 400, JSON.stringify({ error: {
			message: "model is required",
			type: "invalid_request_error"
		} }));
		return;
	}
	if (!cohereReq.messages || !Array.isArray(cohereReq.messages)) {
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v2/chat",
			headers: require_helpers.flattenHeaders(req.headers),
			body: null,
			response: {
				status: 400,
				fixture: null
			}
		});
		require_sse_writer.writeErrorResponse(res, 400, JSON.stringify({ error: {
			message: "Invalid request: messages array is required",
			type: "invalid_request_error"
		} }));
		return;
	}
	const completionReq = cohereToCompletionRequest(cohereReq);
	const fixture = require_router.matchFixture(fixtures, completionReq, journal.fixtureMatchCounts, defaults.requestTransform);
	if (fixture) journal.incrementFixtureMatchCount(fixture, fixtures);
	if (require_chaos.applyChaos(res, fixture, defaults.chaos, req.headers, journal, {
		method: req.method ?? "POST",
		path: req.url ?? "/v2/chat",
		headers: require_helpers.flattenHeaders(req.headers),
		body: completionReq
	}, defaults.registry, defaults.logger)) return;
	if (!fixture) {
		if (defaults.record) {
			if (await require_recorder.proxyAndRecord(req, res, completionReq, "cohere", req.url ?? "/v2/chat", fixtures, defaults, raw)) {
				journal.add({
					method: req.method ?? "POST",
					path: req.url ?? "/v2/chat",
					headers: require_helpers.flattenHeaders(req.headers),
					body: completionReq,
					response: {
						status: res.statusCode ?? 200,
						fixture: null
					}
				});
				return;
			}
		}
		const strictStatus = defaults.strict ? 503 : 404;
		const strictMessage = defaults.strict ? "Strict mode: no fixture matched" : "No fixture matched";
		if (defaults.strict) logger.error(`STRICT: No fixture matched for ${req.method ?? "POST"} ${req.url ?? "/v2/chat"}`);
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v2/chat",
			headers: require_helpers.flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: strictStatus,
				fixture: null
			}
		});
		require_sse_writer.writeErrorResponse(res, strictStatus, JSON.stringify({ error: {
			message: strictMessage,
			type: "invalid_request_error"
		} }));
		return;
	}
	const response = fixture.response;
	const latency = fixture.latency ?? defaults.latency;
	const chunkSize = Math.max(1, fixture.chunkSize ?? defaults.chunkSize);
	if (require_helpers.isErrorResponse(response)) {
		const status = response.status ?? 500;
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v2/chat",
			headers: require_helpers.flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status,
				fixture
			}
		});
		require_sse_writer.writeErrorResponse(res, status, JSON.stringify(response));
		return;
	}
	if (require_helpers.isTextResponse(response)) {
		const journalEntry = journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v2/chat",
			headers: require_helpers.flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		if (cohereReq.stream !== true) {
			const body = buildCohereTextResponse(response.content);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		} else {
			const events = buildCohereTextStreamEvents(response.content, chunkSize);
			const interruption = require_interruption.createInterruptionSignal(fixture);
			if (!await writeCohereSSEStream(res, events, {
				latency,
				streamingProfile: fixture.streamingProfile,
				signal: interruption?.signal,
				onChunkSent: interruption?.tick
			})) {
				if (!res.writableEnded) res.destroy();
				journalEntry.response.interrupted = true;
				journalEntry.response.interruptReason = interruption?.reason();
			}
			interruption?.cleanup();
		}
		return;
	}
	if (require_helpers.isToolCallResponse(response)) {
		const journalEntry = journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v2/chat",
			headers: require_helpers.flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		if (cohereReq.stream !== true) {
			const body = buildCohereToolCallResponse(response.toolCalls, logger);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		} else {
			const events = buildCohereToolCallStreamEvents(response.toolCalls, chunkSize, logger);
			const interruption = require_interruption.createInterruptionSignal(fixture);
			if (!await writeCohereSSEStream(res, events, {
				latency,
				streamingProfile: fixture.streamingProfile,
				signal: interruption?.signal,
				onChunkSent: interruption?.tick
			})) {
				if (!res.writableEnded) res.destroy();
				journalEntry.response.interrupted = true;
				journalEntry.response.interruptReason = interruption?.reason();
			}
			interruption?.cleanup();
		}
		return;
	}
	journal.add({
		method: req.method ?? "POST",
		path: req.url ?? "/v2/chat",
		headers: require_helpers.flattenHeaders(req.headers),
		body: completionReq,
		response: {
			status: 500,
			fixture
		}
	});
	require_sse_writer.writeErrorResponse(res, 500, JSON.stringify({ error: {
		message: "Fixture response did not match any known type",
		type: "server_error"
	} }));
}

//#endregion
exports.cohereToCompletionRequest = cohereToCompletionRequest;
exports.handleCohere = handleCohere;
//# sourceMappingURL=cohere.cjs.map