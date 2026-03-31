const require_helpers = require('./helpers.cjs');
const require_router = require('./router.cjs');
const require_sse_writer = require('./sse-writer.cjs');
const require_interruption = require('./interruption.cjs');
const require_chaos = require('./chaos.cjs');
const require_recorder = require('./recorder.cjs');
const require_aws_event_stream = require('./aws-event-stream.cjs');
const require_bedrock = require('./bedrock.cjs');

//#region src/bedrock-converse.ts
function converseToCompletionRequest(req, modelId) {
	const messages = [];
	if (req.system && req.system.length > 0) {
		const systemText = req.system.map((s) => s.text).join("");
		if (systemText) messages.push({
			role: "system",
			content: systemText
		});
	}
	for (const msg of req.messages) if (msg.role === "user") {
		const toolResults = msg.content.filter((b) => b.toolResult);
		const textBlocks = msg.content.filter((b) => b.text !== void 0 && !b.toolResult);
		if (toolResults.length > 0) {
			for (const block of toolResults) {
				const tr = block.toolResult;
				const resultContent = tr.content.map((c) => c.text ?? "").join("");
				messages.push({
					role: "tool",
					content: resultContent,
					tool_call_id: tr.toolUseId
				});
			}
			if (textBlocks.length > 0) messages.push({
				role: "user",
				content: textBlocks.map((b) => b.text ?? "").join("")
			});
			continue;
		}
		const text = msg.content.filter((b) => b.text !== void 0).map((b) => b.text ?? "").join("");
		messages.push({
			role: "user",
			content: text
		});
	} else if (msg.role === "assistant") {
		const toolUseBlocks = msg.content.filter((b) => b.toolUse);
		const textContent = msg.content.filter((b) => b.text !== void 0).map((b) => b.text ?? "").join("");
		if (toolUseBlocks.length > 0) messages.push({
			role: "assistant",
			content: textContent || null,
			tool_calls: toolUseBlocks.map((b) => ({
				id: b.toolUse.toolUseId,
				type: "function",
				function: {
					name: b.toolUse.name,
					arguments: JSON.stringify(b.toolUse.input)
				}
			}))
		});
		else messages.push({
			role: "assistant",
			content: textContent || null
		});
	}
	let tools;
	if (req.toolConfig?.tools && req.toolConfig.tools.length > 0) tools = req.toolConfig.tools.map((t) => ({
		type: "function",
		function: {
			name: t.toolSpec.name,
			description: t.toolSpec.description,
			parameters: t.toolSpec.inputSchema
		}
	}));
	return {
		model: modelId,
		messages,
		stream: false,
		temperature: req.inferenceConfig?.temperature,
		tools
	};
}
function buildConverseTextResponse(content) {
	return {
		output: { message: {
			role: "assistant",
			content: [{ text: content }]
		} },
		stopReason: "end_turn",
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0
		}
	};
}
function buildConverseToolCallResponse(toolCalls, logger) {
	return {
		output: { message: {
			role: "assistant",
			content: toolCalls.map((tc) => {
				let argsObj;
				try {
					argsObj = JSON.parse(tc.arguments || "{}");
				} catch {
					logger.warn(`Malformed JSON in fixture tool call arguments for "${tc.name}": ${tc.arguments}`);
					argsObj = {};
				}
				return { toolUse: {
					toolUseId: tc.id || require_helpers.generateToolUseId(),
					name: tc.name,
					input: argsObj
				} };
			})
		} },
		stopReason: "tool_use",
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0
		}
	};
}
async function handleConverse(req, res, raw, modelId, fixtures, journal, defaults, setCorsHeaders) {
	const { logger } = defaults;
	setCorsHeaders(res);
	const urlPath = req.url ?? `/model/${modelId}/converse`;
	let converseReq;
	try {
		converseReq = JSON.parse(raw);
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
	if (!converseReq.messages || !Array.isArray(converseReq.messages)) {
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
	const completionReq = converseToCompletionRequest(converseReq, modelId);
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
		require_sse_writer.writeErrorResponse(res, status, JSON.stringify(response));
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
		const body = buildConverseTextResponse(response.content);
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
		const body = buildConverseToolCallResponse(response.toolCalls, logger);
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
async function handleConverseStream(req, res, raw, modelId, fixtures, journal, defaults, setCorsHeaders) {
	const { logger } = defaults;
	setCorsHeaders(res);
	const urlPath = req.url ?? `/model/${modelId}/converse-stream`;
	let converseReq;
	try {
		converseReq = JSON.parse(raw);
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
	if (!converseReq.messages || !Array.isArray(converseReq.messages)) {
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
	const completionReq = converseToCompletionRequest(converseReq, modelId);
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
		const events = require_bedrock.buildBedrockStreamTextEvents(response.content, chunkSize);
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
		const events = require_bedrock.buildBedrockStreamToolCallEvents(response.toolCalls, chunkSize, logger);
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
exports.converseToCompletionRequest = converseToCompletionRequest;
exports.handleConverse = handleConverse;
exports.handleConverseStream = handleConverseStream;
//# sourceMappingURL=bedrock-converse.cjs.map