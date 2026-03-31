import { flattenHeaders, isErrorResponse, isTextResponse, isToolCallResponse } from "./helpers.js";
import { matchFixture } from "./router.js";
import { writeErrorResponse } from "./sse-writer.js";
import { createInterruptionSignal } from "./interruption.js";
import { applyChaos } from "./chaos.js";
import { proxyAndRecord } from "./recorder.js";
import { writeNDJSONStream } from "./ndjson-writer.js";

//#region src/ollama.ts
const DURATION_FIELDS = {
	done_reason: "stop",
	total_duration: 0,
	load_duration: 0,
	prompt_eval_count: 0,
	prompt_eval_duration: 0,
	eval_count: 0,
	eval_duration: 0
};
function ollamaToCompletionRequest(req) {
	const messages = [];
	for (const msg of req.messages) messages.push({
		role: msg.role,
		content: msg.content
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
		temperature: req.options?.temperature,
		max_tokens: req.options?.num_predict,
		tools
	};
}
function ollamaGenerateToCompletionRequest(req) {
	return {
		model: req.model,
		messages: [{
			role: "user",
			content: req.prompt
		}],
		stream: req.stream,
		temperature: req.options?.temperature,
		max_tokens: req.options?.num_predict
	};
}
function buildOllamaChatTextChunks(content, model, chunkSize) {
	const chunks = [];
	for (let i = 0; i < content.length; i += chunkSize) {
		const slice = content.slice(i, i + chunkSize);
		chunks.push({
			model,
			message: {
				role: "assistant",
				content: slice
			},
			done: false
		});
	}
	chunks.push({
		model,
		message: {
			role: "assistant",
			content: ""
		},
		done: true,
		...DURATION_FIELDS
	});
	return chunks;
}
function buildOllamaChatTextResponse(content, model) {
	return {
		model,
		message: {
			role: "assistant",
			content
		},
		done: true,
		...DURATION_FIELDS
	};
}
function buildOllamaChatToolCallChunks(toolCalls, model, logger) {
	const ollamaToolCalls = toolCalls.map((tc) => {
		let argsObj;
		try {
			argsObj = JSON.parse(tc.arguments || "{}");
		} catch {
			logger.warn(`Malformed JSON in fixture tool call arguments for "${tc.name}": ${tc.arguments}`);
			argsObj = {};
		}
		return { function: {
			name: tc.name,
			arguments: argsObj
		} };
	});
	const chunks = [];
	chunks.push({
		model,
		message: {
			role: "assistant",
			content: "",
			tool_calls: ollamaToolCalls
		},
		done: false
	});
	chunks.push({
		model,
		message: {
			role: "assistant",
			content: ""
		},
		done: true,
		...DURATION_FIELDS
	});
	return chunks;
}
function buildOllamaChatToolCallResponse(toolCalls, model, logger) {
	return {
		model,
		message: {
			role: "assistant",
			content: "",
			tool_calls: toolCalls.map((tc) => {
				let argsObj;
				try {
					argsObj = JSON.parse(tc.arguments || "{}");
				} catch {
					logger.warn(`Malformed JSON in fixture tool call arguments for "${tc.name}": ${tc.arguments}`);
					argsObj = {};
				}
				return { function: {
					name: tc.name,
					arguments: argsObj
				} };
			})
		},
		done: true,
		...DURATION_FIELDS
	};
}
function buildOllamaGenerateTextChunks(content, model, chunkSize) {
	const chunks = [];
	const createdAt = (/* @__PURE__ */ new Date()).toISOString();
	for (let i = 0; i < content.length; i += chunkSize) {
		const slice = content.slice(i, i + chunkSize);
		chunks.push({
			model,
			created_at: createdAt,
			response: slice,
			done: false
		});
	}
	chunks.push({
		model,
		created_at: createdAt,
		response: "",
		done: true,
		...DURATION_FIELDS,
		context: []
	});
	return chunks;
}
function buildOllamaGenerateTextResponse(content, model) {
	return {
		model,
		created_at: (/* @__PURE__ */ new Date()).toISOString(),
		response: content,
		done: true,
		...DURATION_FIELDS,
		context: []
	};
}
async function handleOllama(req, res, raw, fixtures, journal, defaults, setCorsHeaders) {
	const { logger } = defaults;
	setCorsHeaders(res);
	const urlPath = req.url ?? "/api/chat";
	let ollamaReq;
	try {
		ollamaReq = JSON.parse(raw);
	} catch {
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
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
	if (!ollamaReq.messages || !Array.isArray(ollamaReq.messages)) {
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
			headers: flattenHeaders(req.headers),
			body: null,
			response: {
				status: 400,
				fixture: null
			}
		});
		writeErrorResponse(res, 400, JSON.stringify({ error: {
			message: "Invalid request: messages array is required",
			type: "invalid_request_error"
		} }));
		return;
	}
	const completionReq = ollamaToCompletionRequest(ollamaReq);
	const fixture = matchFixture(fixtures, completionReq, journal.fixtureMatchCounts, defaults.requestTransform);
	if (fixture) journal.incrementFixtureMatchCount(fixture, fixtures);
	if (applyChaos(res, fixture, defaults.chaos, req.headers, journal, {
		method: req.method ?? "POST",
		path: urlPath,
		headers: flattenHeaders(req.headers),
		body: completionReq
	}, defaults.registry, defaults.logger)) return;
	if (!fixture) {
		if (defaults.record) {
			if (await proxyAndRecord(req, res, completionReq, "ollama", urlPath, fixtures, defaults, raw)) {
				journal.add({
					method: req.method ?? "POST",
					path: urlPath,
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
		if (defaults.strict) logger.error(`STRICT: No fixture matched for ${req.method ?? "POST"} ${urlPath}`);
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
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
	const streaming = ollamaReq.stream !== false;
	if (isErrorResponse(response)) {
		const status = response.status ?? 500;
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
			headers: flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status,
				fixture
			}
		});
		writeErrorResponse(res, status, JSON.stringify(response));
		return;
	}
	if (isTextResponse(response)) {
		const journalEntry = journal.add({
			method: req.method ?? "POST",
			path: urlPath,
			headers: flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		if (!streaming) {
			const body = buildOllamaChatTextResponse(response.content, completionReq.model);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		} else {
			const chunks = buildOllamaChatTextChunks(response.content, completionReq.model, chunkSize);
			const interruption = createInterruptionSignal(fixture);
			if (!await writeNDJSONStream(res, chunks, {
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
			path: urlPath,
			headers: flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		if (!streaming) {
			const body = buildOllamaChatToolCallResponse(response.toolCalls, completionReq.model, logger);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		} else {
			const chunks = buildOllamaChatToolCallChunks(response.toolCalls, completionReq.model, logger);
			const interruption = createInterruptionSignal(fixture);
			if (!await writeNDJSONStream(res, chunks, {
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
		path: urlPath,
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
async function handleOllamaGenerate(req, res, raw, fixtures, journal, defaults, setCorsHeaders) {
	setCorsHeaders(res);
	const urlPath = req.url ?? "/api/generate";
	let generateReq;
	try {
		generateReq = JSON.parse(raw);
	} catch {
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
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
	if (!generateReq.prompt || typeof generateReq.prompt !== "string") {
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
			headers: flattenHeaders(req.headers),
			body: null,
			response: {
				status: 400,
				fixture: null
			}
		});
		writeErrorResponse(res, 400, JSON.stringify({ error: {
			message: "Invalid request: prompt field is required",
			type: "invalid_request_error"
		} }));
		return;
	}
	const completionReq = ollamaGenerateToCompletionRequest(generateReq);
	const fixture = matchFixture(fixtures, completionReq, journal.fixtureMatchCounts, defaults.requestTransform);
	if (fixture) journal.incrementFixtureMatchCount(fixture, fixtures);
	if (applyChaos(res, fixture, defaults.chaos, req.headers, journal, {
		method: req.method ?? "POST",
		path: urlPath,
		headers: flattenHeaders(req.headers),
		body: completionReq
	}, defaults.registry, defaults.logger)) return;
	if (!fixture) {
		if (defaults.record) {
			if (await proxyAndRecord(req, res, completionReq, "ollama", urlPath, fixtures, defaults, raw)) {
				journal.add({
					method: req.method ?? "POST",
					path: urlPath,
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
		if (defaults.strict) defaults.logger.error(`STRICT: No fixture matched for ${req.method ?? "POST"} ${urlPath}`);
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
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
	const streaming = generateReq.stream !== false;
	if (isErrorResponse(response)) {
		const status = response.status ?? 500;
		journal.add({
			method: req.method ?? "POST",
			path: urlPath,
			headers: flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status,
				fixture
			}
		});
		writeErrorResponse(res, status, JSON.stringify(response));
		return;
	}
	if (isTextResponse(response)) {
		const journalEntry = journal.add({
			method: req.method ?? "POST",
			path: urlPath,
			headers: flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		if (!streaming) {
			const body = buildOllamaGenerateTextResponse(response.content, completionReq.model);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		} else {
			const chunks = buildOllamaGenerateTextChunks(response.content, completionReq.model, chunkSize);
			const interruption = createInterruptionSignal(fixture);
			if (!await writeNDJSONStream(res, chunks, {
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
		path: urlPath,
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
export { handleOllama, handleOllamaGenerate, ollamaToCompletionRequest };
//# sourceMappingURL=ollama.js.map