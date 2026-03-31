const require_helpers = require('./helpers.cjs');
const require_router = require('./router.cjs');
const require_sse_writer = require('./sse-writer.cjs');
const require_interruption = require('./interruption.cjs');
const require_chaos = require('./chaos.cjs');
const require_recorder = require('./recorder.cjs');

//#region src/responses.ts
function extractTextContent(content) {
	if (!content) return "";
	if (typeof content === "string") return content;
	return content.filter((p) => p.type === "input_text" || p.type === "output_text").map((p) => p.text ?? "").join("");
}
function responsesInputToMessages(req) {
	const messages = [];
	if (req.instructions) messages.push({
		role: "system",
		content: req.instructions
	});
	for (const item of req.input) if (item.role === "system" || item.role === "developer") messages.push({
		role: "system",
		content: extractTextContent(item.content)
	});
	else if (item.role === "user") messages.push({
		role: "user",
		content: extractTextContent(item.content)
	});
	else if (item.role === "assistant") messages.push({
		role: "assistant",
		content: extractTextContent(item.content)
	});
	else if (item.type === "function_call") messages.push({
		role: "assistant",
		content: null,
		tool_calls: [{
			id: item.call_id ?? require_helpers.generateToolCallId(),
			type: "function",
			function: {
				name: item.name ?? "",
				arguments: item.arguments ?? ""
			}
		}]
	});
	else if (item.type === "function_call_output") messages.push({
		role: "tool",
		content: item.output ?? "",
		tool_call_id: item.call_id
	});
	return messages;
}
function responsesToolsToCompletionsTools(tools) {
	if (!tools || tools.length === 0) return void 0;
	return tools.filter((t) => t.type === "function").map((t) => ({
		type: "function",
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters
		}
	}));
}
function responsesToCompletionRequest(req) {
	return {
		model: req.model,
		messages: responsesInputToMessages(req),
		stream: req.stream,
		temperature: req.temperature,
		tools: responsesToolsToCompletionsTools(req.tools),
		tool_choice: req.tool_choice
	};
}
function responseId() {
	return require_helpers.generateId("resp");
}
function itemId() {
	return require_helpers.generateId("msg");
}
function buildTextStreamEvents(content, model, chunkSize) {
	const respId = responseId();
	const msgId = itemId();
	const created = Math.floor(Date.now() / 1e3);
	const events = [];
	events.push({
		type: "response.created",
		response: {
			id: respId,
			object: "response",
			created_at: created,
			model,
			status: "in_progress",
			output: []
		}
	});
	events.push({
		type: "response.in_progress",
		response: {
			id: respId,
			object: "response",
			created_at: created,
			model,
			status: "in_progress",
			output: []
		}
	});
	events.push({
		type: "response.output_item.added",
		output_index: 0,
		item: {
			type: "message",
			id: msgId,
			status: "in_progress",
			role: "assistant",
			content: []
		}
	});
	events.push({
		type: "response.content_part.added",
		output_index: 0,
		content_index: 0,
		part: {
			type: "output_text",
			text: ""
		}
	});
	for (let i = 0; i < content.length; i += chunkSize) {
		const slice = content.slice(i, i + chunkSize);
		events.push({
			type: "response.output_text.delta",
			item_id: msgId,
			output_index: 0,
			content_index: 0,
			delta: slice
		});
	}
	events.push({
		type: "response.output_text.done",
		output_index: 0,
		content_index: 0,
		text: content
	});
	events.push({
		type: "response.content_part.done",
		output_index: 0,
		content_index: 0,
		part: {
			type: "output_text",
			text: content
		}
	});
	events.push({
		type: "response.output_item.done",
		output_index: 0,
		item: {
			type: "message",
			id: msgId,
			status: "completed",
			role: "assistant",
			content: [{
				type: "output_text",
				text: content
			}]
		}
	});
	events.push({
		type: "response.completed",
		response: {
			id: respId,
			object: "response",
			created_at: created,
			model,
			status: "completed",
			output: [{
				type: "message",
				id: msgId,
				status: "completed",
				role: "assistant",
				content: [{
					type: "output_text",
					text: content
				}]
			}],
			usage: {
				input_tokens: 0,
				output_tokens: 0,
				total_tokens: 0
			}
		}
	});
	return events;
}
function buildToolCallStreamEvents(toolCalls, model, chunkSize) {
	const respId = responseId();
	const created = Math.floor(Date.now() / 1e3);
	const events = [];
	events.push({
		type: "response.created",
		response: {
			id: respId,
			object: "response",
			created_at: created,
			model,
			status: "in_progress",
			output: []
		}
	});
	events.push({
		type: "response.in_progress",
		response: {
			id: respId,
			object: "response",
			created_at: created,
			model,
			status: "in_progress",
			output: []
		}
	});
	const outputItems = [];
	for (let idx = 0; idx < toolCalls.length; idx++) {
		const tc = toolCalls[idx];
		const callId = tc.id || require_helpers.generateToolCallId();
		const fcId = require_helpers.generateId("fc");
		events.push({
			type: "response.output_item.added",
			output_index: idx,
			item: {
				type: "function_call",
				id: fcId,
				call_id: callId,
				name: tc.name,
				arguments: "",
				status: "in_progress"
			}
		});
		const args = tc.arguments;
		for (let i = 0; i < args.length; i += chunkSize) {
			const slice = args.slice(i, i + chunkSize);
			events.push({
				type: "response.function_call_arguments.delta",
				item_id: fcId,
				output_index: idx,
				delta: slice
			});
		}
		events.push({
			type: "response.function_call_arguments.done",
			output_index: idx,
			arguments: args
		});
		const doneItem = {
			type: "function_call",
			id: fcId,
			call_id: callId,
			name: tc.name,
			arguments: args,
			status: "completed"
		};
		events.push({
			type: "response.output_item.done",
			output_index: idx,
			item: doneItem
		});
		outputItems.push(doneItem);
	}
	events.push({
		type: "response.completed",
		response: {
			id: respId,
			object: "response",
			created_at: created,
			model,
			status: "completed",
			output: outputItems,
			usage: {
				input_tokens: 0,
				output_tokens: 0,
				total_tokens: 0
			}
		}
	});
	return events;
}
function buildTextResponse(content, model) {
	const respId = responseId();
	const msgId = itemId();
	return {
		id: respId,
		object: "response",
		created_at: Math.floor(Date.now() / 1e3),
		model,
		status: "completed",
		output: [{
			type: "message",
			id: msgId,
			status: "completed",
			role: "assistant",
			content: [{
				type: "output_text",
				text: content
			}]
		}],
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			total_tokens: 0
		}
	};
}
function buildToolCallResponse(toolCalls, model) {
	return {
		id: responseId(),
		object: "response",
		created_at: Math.floor(Date.now() / 1e3),
		model,
		status: "completed",
		output: toolCalls.map((tc) => ({
			type: "function_call",
			id: require_helpers.generateId("fc"),
			call_id: tc.id || require_helpers.generateToolCallId(),
			name: tc.name,
			arguments: tc.arguments,
			status: "completed"
		})),
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			total_tokens: 0
		}
	};
}
async function writeResponsesSSEStream(res, events, optionsOrLatency) {
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
async function handleResponses(req, res, raw, fixtures, journal, defaults, setCorsHeaders) {
	setCorsHeaders(res);
	let responsesReq;
	try {
		responsesReq = JSON.parse(raw);
	} catch {
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v1/responses",
			headers: require_helpers.flattenHeaders(req.headers),
			body: null,
			response: {
				status: 400,
				fixture: null
			}
		});
		require_sse_writer.writeErrorResponse(res, 400, JSON.stringify({ error: {
			message: "Malformed JSON",
			type: "invalid_request_error",
			code: "invalid_json"
		} }));
		return;
	}
	const completionReq = responsesToCompletionRequest(responsesReq);
	const fixture = require_router.matchFixture(fixtures, completionReq, journal.fixtureMatchCounts, defaults.requestTransform);
	if (fixture) journal.incrementFixtureMatchCount(fixture, fixtures);
	if (require_chaos.applyChaos(res, fixture, defaults.chaos, req.headers, journal, {
		method: req.method ?? "POST",
		path: req.url ?? "/v1/responses",
		headers: require_helpers.flattenHeaders(req.headers),
		body: completionReq
	}, defaults.registry, defaults.logger)) return;
	if (!fixture) {
		if (defaults.record) {
			if (await require_recorder.proxyAndRecord(req, res, completionReq, "openai", req.url ?? "/v1/responses", fixtures, defaults, raw)) {
				journal.add({
					method: req.method ?? "POST",
					path: req.url ?? "/v1/responses",
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
		if (defaults.strict) defaults.logger.error(`STRICT: No fixture matched for ${req.method ?? "POST"} ${req.url ?? "/v1/responses"}`);
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v1/responses",
			headers: require_helpers.flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: strictStatus,
				fixture: null
			}
		});
		require_sse_writer.writeErrorResponse(res, strictStatus, JSON.stringify({ error: {
			message: strictMessage,
			type: "invalid_request_error",
			code: "no_fixture_match"
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
			path: req.url ?? "/v1/responses",
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
			path: req.url ?? "/v1/responses",
			headers: require_helpers.flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		if (responsesReq.stream !== true) {
			const body = buildTextResponse(response.content, completionReq.model);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		} else {
			const events = buildTextStreamEvents(response.content, completionReq.model, chunkSize);
			const interruption = require_interruption.createInterruptionSignal(fixture);
			if (!await writeResponsesSSEStream(res, events, {
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
			path: req.url ?? "/v1/responses",
			headers: require_helpers.flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		if (responsesReq.stream !== true) {
			const body = buildToolCallResponse(response.toolCalls, completionReq.model);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		} else {
			const events = buildToolCallStreamEvents(response.toolCalls, completionReq.model, chunkSize);
			const interruption = require_interruption.createInterruptionSignal(fixture);
			if (!await writeResponsesSSEStream(res, events, {
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
		path: req.url ?? "/v1/responses",
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
exports.buildTextStreamEvents = buildTextStreamEvents;
exports.buildToolCallStreamEvents = buildToolCallStreamEvents;
exports.handleResponses = handleResponses;
exports.responsesToCompletionRequest = responsesToCompletionRequest;
//# sourceMappingURL=responses.cjs.map