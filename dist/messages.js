import { flattenHeaders, generateMessageId, generateToolUseId, isErrorResponse, isTextResponse, isToolCallResponse } from "./helpers.js";
import { matchFixture } from "./router.js";
import { calculateDelay, delay, writeErrorResponse } from "./sse-writer.js";
import { createInterruptionSignal } from "./interruption.js";
import { applyChaos } from "./chaos.js";
import { proxyAndRecord } from "./recorder.js";

//#region src/messages.ts
function extractClaudeTextContent(content) {
	if (typeof content === "string") return content;
	return content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
}
function claudeToCompletionRequest(req) {
	const messages = [];
	if (req.system) {
		const systemText = typeof req.system === "string" ? req.system : req.system.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
		if (systemText) messages.push({
			role: "system",
			content: systemText
		});
	}
	for (const msg of req.messages) if (msg.role === "user") {
		if (typeof msg.content !== "string" && Array.isArray(msg.content)) {
			const toolResults = msg.content.filter((b) => b.type === "tool_result");
			const textBlocks = msg.content.filter((b) => b.type === "text");
			if (toolResults.length > 0) {
				for (const tr of toolResults) {
					const resultContent = typeof tr.content === "string" ? tr.content : Array.isArray(tr.content) ? tr.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("") : "";
					messages.push({
						role: "tool",
						content: resultContent,
						tool_call_id: tr.tool_use_id
					});
				}
				if (textBlocks.length > 0) messages.push({
					role: "user",
					content: textBlocks.map((b) => b.text ?? "").join("")
				});
				continue;
			}
		}
		messages.push({
			role: "user",
			content: extractClaudeTextContent(msg.content)
		});
	} else if (msg.role === "assistant") if (typeof msg.content === "string") messages.push({
		role: "assistant",
		content: msg.content
	});
	else if (Array.isArray(msg.content)) {
		const toolUseBlocks = msg.content.filter((b) => b.type === "tool_use");
		const textContent = extractClaudeTextContent(msg.content);
		if (toolUseBlocks.length > 0) messages.push({
			role: "assistant",
			content: textContent || null,
			tool_calls: toolUseBlocks.map((b) => ({
				id: b.id ?? generateToolUseId(),
				type: "function",
				function: {
					name: b.name ?? "",
					arguments: typeof b.input === "string" ? b.input : JSON.stringify(b.input ?? {})
				}
			}))
		});
		else messages.push({
			role: "assistant",
			content: textContent || null
		});
	} else messages.push({
		role: "assistant",
		content: null
	});
	let tools;
	if (req.tools && req.tools.length > 0) tools = req.tools.map((t) => ({
		type: "function",
		function: {
			name: t.name,
			description: t.description,
			parameters: t.input_schema
		}
	}));
	return {
		model: req.model,
		messages,
		stream: req.stream,
		temperature: req.temperature,
		tools
	};
}
function buildClaudeTextStreamEvents(content, model, chunkSize) {
	const msgId = generateMessageId();
	const events = [];
	events.push({
		type: "message_start",
		message: {
			id: msgId,
			type: "message",
			role: "assistant",
			content: [],
			model,
			stop_reason: null,
			stop_sequence: null,
			usage: {
				input_tokens: 0,
				output_tokens: 0
			}
		}
	});
	events.push({
		type: "content_block_start",
		index: 0,
		content_block: {
			type: "text",
			text: ""
		}
	});
	for (let i = 0; i < content.length; i += chunkSize) {
		const slice = content.slice(i, i + chunkSize);
		events.push({
			type: "content_block_delta",
			index: 0,
			delta: {
				type: "text_delta",
				text: slice
			}
		});
	}
	events.push({
		type: "content_block_stop",
		index: 0
	});
	events.push({
		type: "message_delta",
		delta: {
			stop_reason: "end_turn",
			stop_sequence: null
		},
		usage: { output_tokens: 0 }
	});
	events.push({ type: "message_stop" });
	return events;
}
function buildClaudeToolCallStreamEvents(toolCalls, model, chunkSize, logger) {
	const msgId = generateMessageId();
	const events = [];
	events.push({
		type: "message_start",
		message: {
			id: msgId,
			type: "message",
			role: "assistant",
			content: [],
			model,
			stop_reason: null,
			stop_sequence: null,
			usage: {
				input_tokens: 0,
				output_tokens: 0
			}
		}
	});
	for (let idx = 0; idx < toolCalls.length; idx++) {
		const tc = toolCalls[idx];
		const toolUseId = tc.id || generateToolUseId();
		let argsObj;
		try {
			argsObj = JSON.parse(tc.arguments || "{}");
		} catch {
			logger.warn(`Malformed JSON in fixture tool call arguments for "${tc.name}": ${tc.arguments}`);
			argsObj = {};
		}
		const argsJson = JSON.stringify(argsObj);
		events.push({
			type: "content_block_start",
			index: idx,
			content_block: {
				type: "tool_use",
				id: toolUseId,
				name: tc.name,
				input: {}
			}
		});
		for (let i = 0; i < argsJson.length; i += chunkSize) {
			const slice = argsJson.slice(i, i + chunkSize);
			events.push({
				type: "content_block_delta",
				index: idx,
				delta: {
					type: "input_json_delta",
					partial_json: slice
				}
			});
		}
		events.push({
			type: "content_block_stop",
			index: idx
		});
	}
	events.push({
		type: "message_delta",
		delta: {
			stop_reason: "tool_use",
			stop_sequence: null
		},
		usage: { output_tokens: 0 }
	});
	events.push({ type: "message_stop" });
	return events;
}
function buildClaudeTextResponse(content, model) {
	return {
		id: generateMessageId(),
		type: "message",
		role: "assistant",
		content: [{
			type: "text",
			text: content
		}],
		model,
		stop_reason: "end_turn",
		stop_sequence: null,
		usage: {
			input_tokens: 0,
			output_tokens: 0
		}
	};
}
function buildClaudeToolCallResponse(toolCalls, model, logger) {
	return {
		id: generateMessageId(),
		type: "message",
		role: "assistant",
		content: toolCalls.map((tc) => {
			let argsObj;
			try {
				argsObj = JSON.parse(tc.arguments || "{}");
			} catch {
				logger.warn(`Malformed JSON in fixture tool call arguments for "${tc.name}": ${tc.arguments}`);
				argsObj = {};
			}
			return {
				type: "tool_use",
				id: tc.id || generateToolUseId(),
				name: tc.name,
				input: argsObj
			};
		}),
		model,
		stop_reason: "tool_use",
		stop_sequence: null,
		usage: {
			input_tokens: 0,
			output_tokens: 0
		}
	};
}
async function writeClaudeSSEStream(res, events, optionsOrLatency) {
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
		const chunkDelay = calculateDelay(chunkIndex, profile, latency);
		if (chunkDelay > 0) await delay(chunkDelay, signal);
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
async function handleMessages(req, res, raw, fixtures, journal, defaults, setCorsHeaders) {
	const { logger } = defaults;
	setCorsHeaders(res);
	let claudeReq;
	try {
		claudeReq = JSON.parse(raw);
	} catch {
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v1/messages",
			headers: flattenHeaders(req.headers),
			body: null,
			response: {
				status: 400,
				fixture: null
			}
		});
		writeErrorResponse(res, 400, JSON.stringify({ error: {
			message: "Malformed JSON",
			type: "invalid_request_error"
		} }));
		return;
	}
	const completionReq = claudeToCompletionRequest(claudeReq);
	const fixture = matchFixture(fixtures, completionReq, journal.fixtureMatchCounts, defaults.requestTransform);
	if (fixture) journal.incrementFixtureMatchCount(fixture, fixtures);
	if (applyChaos(res, fixture, defaults.chaos, req.headers, journal, {
		method: req.method ?? "POST",
		path: req.url ?? "/v1/messages",
		headers: flattenHeaders(req.headers),
		body: completionReq
	}, defaults.registry, defaults.logger)) return;
	if (!fixture) {
		if (defaults.record) {
			if (await proxyAndRecord(req, res, completionReq, "anthropic", req.url ?? "/v1/messages", fixtures, defaults, raw)) {
				journal.add({
					method: req.method ?? "POST",
					path: req.url ?? "/v1/messages",
					headers: flattenHeaders(req.headers),
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
		if (defaults.strict) logger.error(`STRICT: No fixture matched for ${req.method ?? "POST"} ${req.url ?? "/v1/messages"}`);
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v1/messages",
			headers: flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: strictStatus,
				fixture: null
			}
		});
		writeErrorResponse(res, strictStatus, JSON.stringify({ error: {
			message: strictMessage,
			type: "invalid_request_error"
		} }));
		return;
	}
	const response = fixture.response;
	const latency = fixture.latency ?? defaults.latency;
	const chunkSize = Math.max(1, fixture.chunkSize ?? defaults.chunkSize);
	if (isErrorResponse(response)) {
		const status = response.status ?? 500;
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v1/messages",
			headers: flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status,
				fixture
			}
		});
		const anthropicError = {
			type: "error",
			error: {
				type: response.error.type ?? "api_error",
				message: response.error.message
			}
		};
		writeErrorResponse(res, status, JSON.stringify(anthropicError));
		return;
	}
	if (isTextResponse(response)) {
		const journalEntry = journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v1/messages",
			headers: flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		if (claudeReq.stream !== true) {
			const body = buildClaudeTextResponse(response.content, completionReq.model);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		} else {
			const events = buildClaudeTextStreamEvents(response.content, completionReq.model, chunkSize);
			const interruption = createInterruptionSignal(fixture);
			if (!await writeClaudeSSEStream(res, events, {
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
	if (isToolCallResponse(response)) {
		const journalEntry = journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v1/messages",
			headers: flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		if (claudeReq.stream !== true) {
			const body = buildClaudeToolCallResponse(response.toolCalls, completionReq.model, logger);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		} else {
			const events = buildClaudeToolCallStreamEvents(response.toolCalls, completionReq.model, chunkSize, logger);
			const interruption = createInterruptionSignal(fixture);
			if (!await writeClaudeSSEStream(res, events, {
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
		path: req.url ?? "/v1/messages",
		headers: flattenHeaders(req.headers),
		body: completionReq,
		response: {
			status: 500,
			fixture
		}
	});
	writeErrorResponse(res, 500, JSON.stringify({ error: {
		message: "Fixture response did not match any known type",
		type: "server_error"
	} }));
}

//#endregion
export { handleMessages };
//# sourceMappingURL=messages.js.map