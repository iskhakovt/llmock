const require_helpers = require('./helpers.cjs');
const require_router = require('./router.cjs');
const require_sse_writer = require('./sse-writer.cjs');
const require_interruption = require('./interruption.cjs');
const require_chaos = require('./chaos.cjs');
const require_recorder = require('./recorder.cjs');
const require_aws_event_stream = require('./aws-event-stream.cjs');

//#region src/bedrock.ts
function extractTextContent(content) {
	if (typeof content === "string") return content;
	return content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
}
function bedrockToCompletionRequest(req, modelId) {
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
			content: extractTextContent(msg.content)
		});
	} else if (msg.role === "assistant") if (typeof msg.content === "string") messages.push({
		role: "assistant",
		content: msg.content
	});
	else if (Array.isArray(msg.content)) {
		const toolUseBlocks = msg.content.filter((b) => b.type === "tool_use");
		const textContent = extractTextContent(msg.content);
		if (toolUseBlocks.length > 0) messages.push({
			role: "assistant",
			content: textContent || null,
			tool_calls: toolUseBlocks.map((b) => ({
				id: b.id ?? require_helpers.generateToolUseId(),
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
		model: modelId,
		messages,
		stream: false,
		temperature: req.temperature,
		tools
	};
}
function buildBedrockTextResponse(content, model) {
	return {
		id: require_helpers.generateMessageId(),
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
function buildBedrockToolCallResponse(toolCalls, model, logger) {
	return {
		id: require_helpers.generateMessageId(),
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
				id: tc.id || require_helpers.generateToolUseId(),
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
async function handleBedrock(req, res, raw, modelId, fixtures, journal, defaults, setCorsHeaders) {
	const { logger } = defaults;
	setCorsHeaders(res);
	const urlPath = req.url ?? `/model/${modelId}/invoke`;
	let bedrockReq;
	try {
		bedrockReq = JSON.parse(raw);
	} catch {
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
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
	if (!bedrockReq.messages || !Array.isArray(bedrockReq.messages)) {
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
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
	const completionReq = bedrockToCompletionRequest(bedrockReq, modelId);
	const fixture = require_router.matchFixture(fixtures, completionReq, journal.fixtureMatchCounts, defaults.requestTransform);
	if (fixture) journal.incrementFixtureMatchCount(fixture, fixtures);
	if (require_chaos.applyChaos(res, fixture, defaults.chaos, req.headers, journal, {
		method: req.method ?? "POST",
		path: urlPath,
		headers: require_helpers.flattenHeaders(req.headers),
		body: completionReq
	}, defaults.registry, defaults.logger)) return;
	if (!fixture) {
		if (defaults.record) {
			if (await require_recorder.proxyAndRecord(req, res, completionReq, "bedrock", urlPath, fixtures, defaults, raw)) {
				journal.add({
					method: req.method ?? "POST",
					path: urlPath,
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
		if (defaults.strict) logger.error(`STRICT: No fixture matched for ${req.method ?? "POST"} ${urlPath}`);
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
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
	if (require_helpers.isErrorResponse(response)) {
		const status = response.status ?? 500;
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
			headers: require_helpers.flattenHeaders(req.headers),
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
		require_sse_writer.writeErrorResponse(res, status, JSON.stringify(anthropicError));
		return;
	}
	if (require_helpers.isTextResponse(response)) {
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
			headers: require_helpers.flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		const body = buildBedrockTextResponse(response.content, completionReq.model);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(body));
		return;
	}
	if (require_helpers.isToolCallResponse(response)) {
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
			headers: require_helpers.flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		const body = buildBedrockToolCallResponse(response.toolCalls, completionReq.model, logger);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify(body));
		return;
	}
	journal.add({
		method: req.method ?? "POST",
		path: urlPath,
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
function buildBedrockStreamTextEvents(content, chunkSize) {
	const events = [];
	events.push({
		eventType: "messageStart",
		payload: { role: "assistant" }
	});
	events.push({
		eventType: "contentBlockStart",
		payload: {
			contentBlockIndex: 0,
			start: {}
		}
	});
	for (let i = 0; i < content.length; i += chunkSize) {
		const slice = content.slice(i, i + chunkSize);
		events.push({
			eventType: "contentBlockDelta",
			payload: {
				contentBlockIndex: 0,
				delta: {
					type: "text_delta",
					text: slice
				}
			}
		});
	}
	events.push({
		eventType: "contentBlockStop",
		payload: { contentBlockIndex: 0 }
	});
	events.push({
		eventType: "messageStop",
		payload: { stopReason: "end_turn" }
	});
	return events;
}
function buildBedrockStreamToolCallEvents(toolCalls, chunkSize, logger) {
	const events = [];
	events.push({
		eventType: "messageStart",
		payload: { role: "assistant" }
	});
	for (let tcIdx = 0; tcIdx < toolCalls.length; tcIdx++) {
		const tc = toolCalls[tcIdx];
		const toolUseId = tc.id || require_helpers.generateToolUseId();
		events.push({
			eventType: "contentBlockStart",
			payload: {
				contentBlockIndex: tcIdx,
				start: { toolUse: {
					toolUseId,
					name: tc.name
				} }
			}
		});
		let argsStr;
		try {
			const parsed = JSON.parse(tc.arguments || "{}");
			argsStr = JSON.stringify(parsed);
		} catch {
			logger.warn(`Malformed JSON in fixture tool call arguments for "${tc.name}": ${tc.arguments}`);
			argsStr = "{}";
		}
		for (let i = 0; i < argsStr.length; i += chunkSize) {
			const slice = argsStr.slice(i, i + chunkSize);
			events.push({
				eventType: "contentBlockDelta",
				payload: {
					contentBlockIndex: tcIdx,
					delta: {
						type: "input_json_delta",
						inputJSON: slice
					}
				}
			});
		}
		events.push({
			eventType: "contentBlockStop",
			payload: { contentBlockIndex: tcIdx }
		});
	}
	events.push({
		eventType: "messageStop",
		payload: { stopReason: "tool_use" }
	});
	return events;
}
async function handleBedrockStream(req, res, raw, modelId, fixtures, journal, defaults, setCorsHeaders) {
	const { logger } = defaults;
	setCorsHeaders(res);
	const urlPath = req.url ?? `/model/${modelId}/invoke-with-response-stream`;
	let bedrockReq;
	try {
		bedrockReq = JSON.parse(raw);
	} catch {
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
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
	if (!bedrockReq.messages || !Array.isArray(bedrockReq.messages)) {
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
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
	const completionReq = bedrockToCompletionRequest(bedrockReq, modelId);
	const fixture = require_router.matchFixture(fixtures, completionReq, journal.fixtureMatchCounts, defaults.requestTransform);
	if (fixture) journal.incrementFixtureMatchCount(fixture, fixtures);
	if (require_chaos.applyChaos(res, fixture, defaults.chaos, req.headers, journal, {
		method: req.method ?? "POST",
		path: urlPath,
		headers: require_helpers.flattenHeaders(req.headers),
		body: completionReq
	}, defaults.registry, defaults.logger)) return;
	if (!fixture) {
		if (defaults.record) {
			if (await require_recorder.proxyAndRecord(req, res, completionReq, "bedrock", urlPath, fixtures, defaults, raw)) {
				journal.add({
					method: req.method ?? "POST",
					path: urlPath,
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
		if (defaults.strict) logger.error(`STRICT: No fixture matched for ${req.method ?? "POST"} ${urlPath}`);
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
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
			path: urlPath,
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
			path: urlPath,
			headers: require_helpers.flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		const events = buildBedrockStreamTextEvents(response.content, chunkSize);
		const interruption = require_interruption.createInterruptionSignal(fixture);
		if (!await require_aws_event_stream.writeEventStream(res, events, {
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
		return;
	}
	if (require_helpers.isToolCallResponse(response)) {
		const journalEntry = journal.add({
			method: req.method ?? "POST",
			path: urlPath,
			headers: require_helpers.flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		const events = buildBedrockStreamToolCallEvents(response.toolCalls, chunkSize, logger);
		const interruption = require_interruption.createInterruptionSignal(fixture);
		if (!await require_aws_event_stream.writeEventStream(res, events, {
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
		return;
	}
	journal.add({
		method: req.method ?? "POST",
		path: urlPath,
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
exports.bedrockToCompletionRequest = bedrockToCompletionRequest;
exports.buildBedrockStreamTextEvents = buildBedrockStreamTextEvents;
exports.buildBedrockStreamToolCallEvents = buildBedrockStreamToolCallEvents;
exports.handleBedrock = handleBedrock;
exports.handleBedrockStream = handleBedrockStream;
//# sourceMappingURL=bedrock.cjs.map