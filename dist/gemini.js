import { flattenHeaders, generateToolCallId, isErrorResponse, isTextResponse, isToolCallResponse } from "./helpers.js";
import { matchFixture } from "./router.js";
import { calculateDelay, delay, writeErrorResponse } from "./sse-writer.js";
import { createInterruptionSignal } from "./interruption.js";
import { applyChaos } from "./chaos.js";
import { proxyAndRecord } from "./recorder.js";

//#region src/gemini.ts
function geminiToCompletionRequest(req, model, stream) {
	const messages = [];
	if (req.systemInstruction) {
		const text = req.systemInstruction.parts.filter((p) => p.text !== void 0).map((p) => p.text).join("");
		if (text) messages.push({
			role: "system",
			content: text
		});
	}
	if (req.contents) for (const content of req.contents) {
		const role = content.role ?? "user";
		if (role === "user") {
			const funcResponses = content.parts.filter((p) => p.functionResponse);
			const textParts = content.parts.filter((p) => p.text !== void 0);
			if (funcResponses.length > 0) {
				for (let i = 0; i < funcResponses.length; i++) {
					const part = funcResponses[i];
					messages.push({
						role: "tool",
						content: typeof part.functionResponse.response === "string" ? part.functionResponse.response : JSON.stringify(part.functionResponse.response),
						tool_call_id: `call_gemini_${part.functionResponse.name}_${i}`
					});
				}
				if (textParts.length > 0) messages.push({
					role: "user",
					content: textParts.map((p) => p.text).join("")
				});
			} else {
				const text = textParts.map((p) => p.text).join("");
				messages.push({
					role: "user",
					content: text
				});
			}
		} else if (role === "model") {
			const funcCalls = content.parts.filter((p) => p.functionCall);
			const textParts = content.parts.filter((p) => p.text !== void 0);
			if (funcCalls.length > 0) messages.push({
				role: "assistant",
				content: null,
				tool_calls: funcCalls.map((p, i) => ({
					id: `call_gemini_${p.functionCall.name}_${i}`,
					type: "function",
					function: {
						name: p.functionCall.name,
						arguments: JSON.stringify(p.functionCall.args)
					}
				}))
			});
			else {
				const text = textParts.map((p) => p.text).join("");
				messages.push({
					role: "assistant",
					content: text
				});
			}
		}
	}
	let tools;
	if (req.tools && req.tools.length > 0) {
		const decls = req.tools.flatMap((t) => t.functionDeclarations ?? []);
		if (decls.length > 0) tools = decls.map((d) => ({
			type: "function",
			function: {
				name: d.name,
				description: d.description,
				parameters: d.parameters
			}
		}));
	}
	return {
		model,
		messages,
		stream,
		temperature: req.generationConfig?.temperature,
		tools
	};
}
function buildGeminiTextStreamChunks(content, chunkSize) {
	const chunks = [];
	for (let i = 0; i < content.length; i += chunkSize) {
		const slice = content.slice(i, i + chunkSize);
		const isLast = i + chunkSize >= content.length;
		const chunk = {
			candidates: [{
				content: {
					role: "model",
					parts: [{ text: slice }]
				},
				index: 0,
				...isLast ? { finishReason: "STOP" } : {}
			}],
			...isLast ? { usageMetadata: {
				promptTokenCount: 0,
				candidatesTokenCount: 0,
				totalTokenCount: 0
			} } : {}
		};
		chunks.push(chunk);
	}
	if (content.length === 0) chunks.push({
		candidates: [{
			content: {
				role: "model",
				parts: [{ text: "" }]
			},
			finishReason: "STOP",
			index: 0
		}],
		usageMetadata: {
			promptTokenCount: 0,
			candidatesTokenCount: 0,
			totalTokenCount: 0
		}
	});
	return chunks;
}
function buildGeminiToolCallStreamChunks(toolCalls, logger) {
	return [{
		candidates: [{
			content: {
				role: "model",
				parts: toolCalls.map((tc) => {
					let argsObj;
					try {
						argsObj = JSON.parse(tc.arguments || "{}");
					} catch {
						logger.warn(`Malformed JSON in fixture tool call arguments for "${tc.name}": ${tc.arguments}`);
						argsObj = {};
					}
					return { functionCall: {
						name: tc.name,
						args: argsObj,
						id: tc.id || generateToolCallId()
					} };
				})
			},
			finishReason: "FUNCTION_CALL",
			index: 0
		}],
		usageMetadata: {
			promptTokenCount: 0,
			candidatesTokenCount: 0,
			totalTokenCount: 0
		}
	}];
}
function buildGeminiTextResponse(content) {
	return {
		candidates: [{
			content: {
				role: "model",
				parts: [{ text: content }]
			},
			finishReason: "STOP",
			index: 0
		}],
		usageMetadata: {
			promptTokenCount: 0,
			candidatesTokenCount: 0,
			totalTokenCount: 0
		}
	};
}
function buildGeminiToolCallResponse(toolCalls, logger) {
	return {
		candidates: [{
			content: {
				role: "model",
				parts: toolCalls.map((tc) => {
					let argsObj;
					try {
						argsObj = JSON.parse(tc.arguments || "{}");
					} catch {
						logger.warn(`Malformed JSON in fixture tool call arguments for "${tc.name}": ${tc.arguments}`);
						argsObj = {};
					}
					return { functionCall: {
						name: tc.name,
						args: argsObj,
						id: tc.id || generateToolCallId()
					} };
				})
			},
			finishReason: "FUNCTION_CALL",
			index: 0
		}],
		usageMetadata: {
			promptTokenCount: 0,
			candidatesTokenCount: 0,
			totalTokenCount: 0
		}
	};
}
async function writeGeminiSSEStream(res, chunks, optionsOrLatency) {
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
	for (const chunk of chunks) {
		const chunkDelay = calculateDelay(chunkIndex, profile, latency);
		if (chunkDelay > 0) await delay(chunkDelay, signal);
		if (signal?.aborted) return false;
		if (res.writableEnded) return true;
		res.write(`data: ${JSON.stringify(chunk)}\n\n`);
		onChunkSent?.();
		if (signal?.aborted) return false;
		chunkIndex++;
	}
	if (!res.writableEnded) res.end();
	return true;
}
async function handleGemini(req, res, raw, model, streaming, fixtures, journal, defaults, setCorsHeaders, providerKey = "gemini") {
	const { logger } = defaults;
	setCorsHeaders(res);
	let geminiReq;
	try {
		geminiReq = JSON.parse(raw);
	} catch {
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? `/v1beta/models/${model}:generateContent`,
			headers: flattenHeaders(req.headers),
			body: null,
			response: {
				status: 400,
				fixture: null
			}
		});
		writeErrorResponse(res, 400, JSON.stringify({ error: {
			message: "Malformed JSON",
			code: 400,
			status: "INVALID_ARGUMENT"
		} }));
		return;
	}
	const completionReq = geminiToCompletionRequest(geminiReq, model, streaming);
	const fixture = matchFixture(fixtures, completionReq, journal.fixtureMatchCounts, defaults.requestTransform);
	const path = req.url ?? `/v1beta/models/${model}:generateContent`;
	if (fixture) journal.incrementFixtureMatchCount(fixture, fixtures);
	if (applyChaos(res, fixture, defaults.chaos, req.headers, journal, {
		method: req.method ?? "POST",
		path,
		headers: flattenHeaders(req.headers),
		body: completionReq
	}, defaults.registry, defaults.logger)) return;
	if (!fixture) {
		if (defaults.record) {
			if (await proxyAndRecord(req, res, completionReq, providerKey, path, fixtures, defaults, raw)) {
				journal.add({
					method: req.method ?? "POST",
					path,
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
		if (defaults.strict) logger.error(`STRICT: No fixture matched for ${req.method ?? "POST"} ${path}`);
		journal.add({
			method: req.method ?? "POST",
			path,
			headers: flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: strictStatus,
				fixture: null
			}
		});
		writeErrorResponse(res, strictStatus, JSON.stringify({ error: {
			message: strictMessage,
			code: strictStatus,
			status: defaults.strict ? "UNAVAILABLE" : "NOT_FOUND"
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
			path,
			headers: flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status,
				fixture
			}
		});
		const geminiError = { error: {
			code: status,
			message: response.error.message,
			status: response.error.type ?? "ERROR"
		} };
		writeErrorResponse(res, status, JSON.stringify(geminiError));
		return;
	}
	if (isTextResponse(response)) {
		const journalEntry = journal.add({
			method: req.method ?? "POST",
			path,
			headers: flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		if (!streaming) {
			const body = buildGeminiTextResponse(response.content);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		} else {
			const chunks = buildGeminiTextStreamChunks(response.content, chunkSize);
			const interruption = createInterruptionSignal(fixture);
			if (!await writeGeminiSSEStream(res, chunks, {
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
			path,
			headers: flattenHeaders(req.headers),
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		if (!streaming) {
			const body = buildGeminiToolCallResponse(response.toolCalls, logger);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		} else {
			const chunks = buildGeminiToolCallStreamChunks(response.toolCalls, logger);
			const interruption = createInterruptionSignal(fixture);
			if (!await writeGeminiSSEStream(res, chunks, {
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
		path,
		headers: flattenHeaders(req.headers),
		body: completionReq,
		response: {
			status: 500,
			fixture
		}
	});
	writeErrorResponse(res, 500, JSON.stringify({ error: {
		message: "Fixture response did not match any known type",
		code: 500,
		status: "INTERNAL"
	} }));
}

//#endregion
export { handleGemini };
//# sourceMappingURL=gemini.js.map