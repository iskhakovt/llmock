const require_runtime = require('./_virtual/_rolldown/runtime.cjs');
const require_helpers = require('./helpers.cjs');
const require_journal = require('./journal.cjs');
const require_router = require('./router.cjs');
const require_sse_writer = require('./sse-writer.cjs');
const require_interruption = require('./interruption.cjs');
const require_chaos = require('./chaos.cjs');
const require_recorder = require('./recorder.cjs');
const require_responses = require('./responses.cjs');
const require_messages = require('./messages.cjs');
const require_gemini = require('./gemini.cjs');
const require_bedrock = require('./bedrock.cjs');
const require_bedrock_converse = require('./bedrock-converse.cjs');
const require_embeddings = require('./embeddings.cjs');
const require_ollama = require('./ollama.cjs');
const require_cohere = require('./cohere.cjs');
const require_ws_framing = require('./ws-framing.cjs');
const require_ws_responses = require('./ws-responses.cjs');
const require_ws_realtime = require('./ws-realtime.cjs');
const require_ws_gemini_live = require('./ws-gemini-live.cjs');
const require_logger = require('./logger.cjs');
const require_metrics = require('./metrics.cjs');
let node_http = require("node:http");
node_http = require_runtime.__toESM(node_http);

//#region src/server.ts
const COMPLETIONS_PATH = "/v1/chat/completions";
const RESPONSES_PATH = "/v1/responses";
const REALTIME_PATH = "/v1/realtime";
const GEMINI_LIVE_PATH = "/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const MESSAGES_PATH = "/v1/messages";
const EMBEDDINGS_PATH = "/v1/embeddings";
const COHERE_CHAT_PATH = "/v2/chat";
const DEFAULT_CHUNK_SIZE = 20;
const GEMINI_PATH_RE = /^\/v1beta\/models\/([^:]+):(generateContent|streamGenerateContent)$/;
const AZURE_DEPLOYMENT_RE = /^\/openai\/deployments\/([^/]+)\/(chat\/completions|embeddings)$/;
const BEDROCK_INVOKE_RE = /^\/model\/([^/]+)\/invoke$/;
const BEDROCK_STREAM_RE = /^\/model\/([^/]+)\/invoke-with-response-stream$/;
const BEDROCK_CONVERSE_RE = /^\/model\/([^/]+)\/converse$/;
const BEDROCK_CONVERSE_STREAM_RE = /^\/model\/([^/]+)\/converse-stream$/;
const VERTEX_AI_RE = /^\/v1\/projects\/[^/]+\/locations\/[^/]+\/publishers\/google\/models\/([^/:]+):(generateContent|streamGenerateContent)$/;
const OLLAMA_CHAT_PATH = "/api/chat";
const OLLAMA_GENERATE_PATH = "/api/generate";
const OLLAMA_TAGS_PATH = "/api/tags";
const HEALTH_PATH = "/health";
const READY_PATH = "/ready";
const MODELS_PATH = "/v1/models";
const REQUESTS_PATH = "/v1/_requests";
const DEFAULT_MODELS = [
	"gpt-4",
	"gpt-4o",
	"claude-3-5-sonnet-20241022",
	"gemini-2.0-flash",
	"text-embedding-3-small"
];
const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function setCorsHeaders(res) {
	for (const [key, value] of Object.entries(CORS_HEADERS)) res.setHeader(key, value);
}
async function readBody(req) {
	const buffers = [];
	for await (const chunk of req) buffers.push(chunk);
	return Buffer.concat(buffers).toString();
}
function handleOptions(res) {
	setCorsHeaders(res);
	res.writeHead(204);
	res.end();
}
function handleNotFound(res, message) {
	setCorsHeaders(res);
	require_sse_writer.writeErrorResponse(res, 404, JSON.stringify({ error: {
		message,
		type: "not_found"
	} }));
}
async function handleCompletions(req, res, fixtures, journal, defaults, modelFallback, providerKey) {
	setCorsHeaders(res);
	let raw;
	try {
		raw = await readBody(req);
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Failed to read request body";
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? COMPLETIONS_PATH,
			headers: require_helpers.flattenHeaders(req.headers),
			body: null,
			response: {
				status: 500,
				fixture: null
			}
		});
		require_sse_writer.writeErrorResponse(res, 500, JSON.stringify({ error: {
			message: `Request body read failed: ${msg}`,
			type: "server_error"
		} }));
		return;
	}
	let body;
	try {
		body = JSON.parse(raw);
		if (modelFallback && !body.model) body.model = modelFallback;
	} catch {
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? COMPLETIONS_PATH,
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
	const fixture = require_router.matchFixture(fixtures, body, journal.fixtureMatchCounts, defaults.requestTransform);
	if (fixture) journal.incrementFixtureMatchCount(fixture, fixtures);
	const method = req.method ?? "POST";
	const path = req.url ?? COMPLETIONS_PATH;
	const flatHeaders = require_helpers.flattenHeaders(req.headers);
	if (require_chaos.applyChaos(res, fixture, defaults.chaos, req.headers, journal, {
		method,
		path,
		headers: flatHeaders,
		body
	}, defaults.registry, defaults.logger)) return;
	if (!fixture) {
		if (defaults.record && providerKey) {
			if (await require_recorder.proxyAndRecord(req, res, body, providerKey, req.url ?? COMPLETIONS_PATH, fixtures, defaults, raw)) {
				journal.add({
					method: req.method ?? "POST",
					path: req.url ?? COMPLETIONS_PATH,
					headers: require_helpers.flattenHeaders(req.headers),
					body,
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
		if (defaults.strict) defaults.logger.error(`STRICT: No fixture matched for ${req.method ?? "POST"} ${req.url ?? COMPLETIONS_PATH}`);
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? COMPLETIONS_PATH,
			headers: require_helpers.flattenHeaders(req.headers),
			body,
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
			path: req.url ?? COMPLETIONS_PATH,
			headers: require_helpers.flattenHeaders(req.headers),
			body,
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
			path: req.url ?? COMPLETIONS_PATH,
			headers: require_helpers.flattenHeaders(req.headers),
			body,
			response: {
				status: 200,
				fixture
			}
		});
		if (body.stream !== true) {
			const completion = require_helpers.buildTextCompletion(response.content, body.model);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(completion));
		} else {
			const chunks = require_helpers.buildTextChunks(response.content, body.model, chunkSize);
			const interruption = require_interruption.createInterruptionSignal(fixture);
			if (!await require_sse_writer.writeSSEStream(res, chunks, {
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
			path: req.url ?? COMPLETIONS_PATH,
			headers: require_helpers.flattenHeaders(req.headers),
			body,
			response: {
				status: 200,
				fixture
			}
		});
		if (body.stream !== true) {
			const completion = require_helpers.buildToolCallCompletion(response.toolCalls, body.model);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(completion));
		} else {
			const chunks = require_helpers.buildToolCallChunks(response.toolCalls, body.model, chunkSize);
			const interruption = require_interruption.createInterruptionSignal(fixture);
			if (!await require_sse_writer.writeSSEStream(res, chunks, {
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
		path: req.url ?? COMPLETIONS_PATH,
		headers: require_helpers.flattenHeaders(req.headers),
		body,
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
async function createServer(fixtures, options) {
	const host = options?.host ?? "127.0.0.1";
	const port = options?.port ?? 0;
	const logger = new require_logger.Logger(options?.logLevel ?? "silent");
	const registry = options?.metrics ? require_metrics.createMetricsRegistry() : void 0;
	const serverOptions = options ?? {};
	const defaults = {
		latency: serverOptions.latency ?? 0,
		chunkSize: Math.max(1, serverOptions.chunkSize ?? DEFAULT_CHUNK_SIZE),
		logger,
		get chaos() {
			return serverOptions.chaos;
		},
		registry,
		get record() {
			return serverOptions.record;
		},
		get strict() {
			return serverOptions.strict;
		},
		get requestTransform() {
			return serverOptions.requestTransform;
		}
	};
	if (options?.chaos) {
		const chaosRates = [
			{
				name: "dropRate",
				value: options.chaos.dropRate
			},
			{
				name: "malformedRate",
				value: options.chaos.malformedRate
			},
			{
				name: "disconnectRate",
				value: options.chaos.disconnectRate
			}
		];
		for (const { name, value } of chaosRates) if (value !== void 0 && (value < 0 || value > 1)) logger.warn(`Chaos ${name} (${value}) is outside 0-1 range — will be clamped at runtime`);
	}
	const journal = new require_journal.Journal();
	if (registry) registry.setGauge("llmock_fixtures_loaded", {}, fixtures.length);
	const server = node_http.createServer((req, res) => {
		if (req.method === "OPTIONS") {
			handleOptions(res);
			return;
		}
		const startTime = registry ? process.hrtime.bigint() : 0n;
		const parsedUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
		let pathname = parsedUrl.pathname;
		if (registry) {
			const rawPathname = pathname;
			res.on("finish", () => {
				try {
					const normalizedPath = require_metrics.normalizePathLabel(rawPathname);
					const method = req.method ?? "UNKNOWN";
					const status = String(res.statusCode);
					registry.incrementCounter("llmock_requests_total", {
						method,
						path: normalizedPath,
						status
					});
					const elapsed = Number(process.hrtime.bigint() - startTime) / 1e9;
					registry.observeHistogram("llmock_request_duration_seconds", {
						method,
						path: normalizedPath
					}, elapsed);
				} catch (err) {
					defaults.logger.warn("metrics instrumentation error", err);
				}
			});
		}
		let azureDeploymentId;
		const azureMatch = pathname.match(AZURE_DEPLOYMENT_RE);
		if (azureMatch && req.method === "POST") {
			azureDeploymentId = azureMatch[1];
			pathname = `/v1/${azureMatch[2]}`;
		}
		if (!azureDeploymentId && pathname.startsWith("/openai/")) pathname = pathname.slice(7);
		if (pathname === HEALTH_PATH && req.method === "GET") {
			setCorsHeaders(res);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ status: "ok" }));
			return;
		}
		if (pathname === READY_PATH && req.method === "GET") {
			setCorsHeaders(res);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ status: "ready" }));
			return;
		}
		if (pathname === "/metrics" && req.method === "GET") {
			if (!registry) {
				handleNotFound(res, "Not found");
				return;
			}
			setCorsHeaders(res);
			res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
			res.end(registry.serialize());
			return;
		}
		if (pathname === MODELS_PATH && req.method === "GET") {
			setCorsHeaders(res);
			const modelIds = /* @__PURE__ */ new Set();
			for (const f of fixtures) if (f.match.model && typeof f.match.model === "string") modelIds.add(f.match.model);
			const data = (modelIds.size > 0 ? [...modelIds] : DEFAULT_MODELS).map((id) => ({
				id,
				object: "model",
				created: 1686935002,
				owned_by: "llmock"
			}));
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({
				object: "list",
				data
			}));
			return;
		}
		if (pathname === REQUESTS_PATH) {
			setCorsHeaders(res);
			if (req.method === "GET") {
				const limitParam = parsedUrl.searchParams.get("limit");
				let opts;
				if (limitParam) {
					const limit = parseInt(limitParam, 10);
					if (Number.isNaN(limit) || limit <= 0) {
						require_sse_writer.writeErrorResponse(res, 400, JSON.stringify({ error: {
							message: `Invalid limit parameter: "${limitParam}"`,
							type: "invalid_request_error"
						} }));
						return;
					}
					opts = { limit };
				}
				const entries = journal.getAll(opts);
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(entries));
				return;
			}
			if (req.method === "DELETE") {
				journal.clear();
				res.writeHead(204);
				res.end();
				return;
			}
			handleNotFound(res, "Not found");
			return;
		}
		if (pathname === RESPONSES_PATH && req.method === "POST") {
			readBody(req).then((raw) => require_responses.handleResponses(req, res, raw, fixtures, journal, defaults, setCorsHeaders)).catch((err) => {
				const msg = err instanceof Error ? err.message : "Internal error";
				if (!res.headersSent) require_sse_writer.writeErrorResponse(res, 500, JSON.stringify({ error: {
					message: msg,
					type: "server_error"
				} }));
				else if (!res.writableEnded) {
					try {
						res.write(`event: error\ndata: ${JSON.stringify({ error: { message: msg } })}\n\n`);
					} catch (writeErr) {
						logger.debug("Failed to write error recovery response:", writeErr);
					}
					res.end();
				}
			});
			return;
		}
		if (pathname === MESSAGES_PATH && req.method === "POST") {
			readBody(req).then((raw) => require_messages.handleMessages(req, res, raw, fixtures, journal, defaults, setCorsHeaders)).catch((err) => {
				const msg = err instanceof Error ? err.message : "Internal error";
				if (!res.headersSent) require_sse_writer.writeErrorResponse(res, 500, JSON.stringify({ error: {
					message: msg,
					type: "server_error"
				} }));
				else if (!res.writableEnded) {
					try {
						res.write(`event: error\ndata: ${JSON.stringify({ error: { message: msg } })}\n\n`);
					} catch (writeErr) {
						logger.debug("Failed to write error recovery response:", writeErr);
					}
					res.end();
				}
			});
			return;
		}
		if (pathname === COHERE_CHAT_PATH && req.method === "POST") {
			readBody(req).then((raw) => require_cohere.handleCohere(req, res, raw, fixtures, journal, defaults, setCorsHeaders)).catch((err) => {
				const msg = err instanceof Error ? err.message : "Internal error";
				if (!res.headersSent) require_sse_writer.writeErrorResponse(res, 500, JSON.stringify({ error: {
					message: msg,
					type: "server_error"
				} }));
				else if (!res.writableEnded) {
					try {
						res.write(`event: error\ndata: ${JSON.stringify({ error: { message: msg } })}\n\n`);
					} catch (writeErr) {
						logger.debug("Failed to write error recovery response:", writeErr);
					}
					res.end();
				}
			});
			return;
		}
		if (pathname === EMBEDDINGS_PATH && req.method === "POST") {
			const deploymentId = azureDeploymentId;
			readBody(req).then((raw) => {
				if (deploymentId) try {
					const parsed = JSON.parse(raw);
					if (!parsed.model) {
						parsed.model = deploymentId;
						return require_embeddings.handleEmbeddings(req, res, JSON.stringify(parsed), fixtures, journal, defaults, setCorsHeaders);
					}
				} catch {}
				return require_embeddings.handleEmbeddings(req, res, raw, fixtures, journal, defaults, setCorsHeaders);
			}).catch((err) => {
				const msg = err instanceof Error ? err.message : "Internal error";
				if (!res.headersSent) require_sse_writer.writeErrorResponse(res, 500, JSON.stringify({ error: {
					message: msg,
					type: "server_error"
				} }));
				else if (!res.writableEnded) res.destroy();
			});
			return;
		}
		const geminiMatch = pathname.match(GEMINI_PATH_RE);
		if (geminiMatch && req.method === "POST") {
			const geminiModel = geminiMatch[1];
			const streaming = geminiMatch[2] === "streamGenerateContent";
			readBody(req).then((raw) => require_gemini.handleGemini(req, res, raw, geminiModel, streaming, fixtures, journal, defaults, setCorsHeaders)).catch((err) => {
				const msg = err instanceof Error ? err.message : "Internal error";
				if (!res.headersSent) require_sse_writer.writeErrorResponse(res, 500, JSON.stringify({ error: {
					message: msg,
					type: "server_error"
				} }));
				else if (!res.writableEnded) {
					try {
						res.write(`data: ${JSON.stringify({ error: { message: msg } })}\n\n`);
					} catch (writeErr) {
						logger.debug("Failed to write error recovery response:", writeErr);
					}
					res.end();
				}
			});
			return;
		}
		const vertexMatch = pathname.match(VERTEX_AI_RE);
		if (vertexMatch && req.method === "POST") {
			const vertexModel = vertexMatch[1];
			const streaming = vertexMatch[2] === "streamGenerateContent";
			readBody(req).then((raw) => require_gemini.handleGemini(req, res, raw, vertexModel, streaming, fixtures, journal, defaults, setCorsHeaders, "vertexai")).catch((err) => {
				const msg = err instanceof Error ? err.message : "Internal error";
				if (!res.headersSent) require_sse_writer.writeErrorResponse(res, 500, JSON.stringify({ error: {
					message: msg,
					type: "server_error"
				} }));
				else if (!res.writableEnded) {
					try {
						res.write(`data: ${JSON.stringify({ error: { message: msg } })}\n\n`);
					} catch (writeErr) {
						logger.debug("Failed to write error recovery response:", writeErr);
					}
					res.end();
				}
			});
			return;
		}
		const bedrockMatch = pathname.match(BEDROCK_INVOKE_RE);
		if (bedrockMatch && req.method === "POST") {
			const bedrockModelId = bedrockMatch[1];
			readBody(req).then((raw) => require_bedrock.handleBedrock(req, res, raw, bedrockModelId, fixtures, journal, defaults, setCorsHeaders)).catch((err) => {
				const msg = err instanceof Error ? err.message : "Internal error";
				if (!res.headersSent) require_sse_writer.writeErrorResponse(res, 500, JSON.stringify({ error: {
					message: msg,
					type: "server_error"
				} }));
				else if (!res.writableEnded) res.destroy();
			});
			return;
		}
		const bedrockStreamMatch = pathname.match(BEDROCK_STREAM_RE);
		if (bedrockStreamMatch && req.method === "POST") {
			const bedrockModelId = bedrockStreamMatch[1];
			readBody(req).then((raw) => require_bedrock.handleBedrockStream(req, res, raw, bedrockModelId, fixtures, journal, defaults, setCorsHeaders)).catch((err) => {
				const msg = err instanceof Error ? err.message : "Internal error";
				if (!res.headersSent) require_sse_writer.writeErrorResponse(res, 500, JSON.stringify({ error: {
					message: msg,
					type: "server_error"
				} }));
				else if (!res.writableEnded) res.destroy();
			});
			return;
		}
		const converseMatch = pathname.match(BEDROCK_CONVERSE_RE);
		if (converseMatch && req.method === "POST") {
			const converseModelId = converseMatch[1];
			readBody(req).then((raw) => require_bedrock_converse.handleConverse(req, res, raw, converseModelId, fixtures, journal, defaults, setCorsHeaders)).catch((err) => {
				const msg = err instanceof Error ? err.message : "Internal error";
				if (!res.headersSent) require_sse_writer.writeErrorResponse(res, 500, JSON.stringify({ error: {
					message: msg,
					type: "server_error"
				} }));
				else if (!res.writableEnded) res.destroy();
			});
			return;
		}
		const converseStreamMatch = pathname.match(BEDROCK_CONVERSE_STREAM_RE);
		if (converseStreamMatch && req.method === "POST") {
			const converseStreamModelId = converseStreamMatch[1];
			readBody(req).then((raw) => require_bedrock_converse.handleConverseStream(req, res, raw, converseStreamModelId, fixtures, journal, defaults, setCorsHeaders)).catch((err) => {
				const msg = err instanceof Error ? err.message : "Internal error";
				if (!res.headersSent) require_sse_writer.writeErrorResponse(res, 500, JSON.stringify({ error: {
					message: msg,
					type: "server_error"
				} }));
				else if (!res.writableEnded) res.destroy();
			});
			return;
		}
		if (pathname === OLLAMA_CHAT_PATH && req.method === "POST") {
			readBody(req).then((raw) => require_ollama.handleOllama(req, res, raw, fixtures, journal, defaults, setCorsHeaders)).catch((err) => {
				const msg = err instanceof Error ? err.message : "Internal error";
				if (!res.headersSent) require_sse_writer.writeErrorResponse(res, 500, JSON.stringify({ error: {
					message: msg,
					type: "server_error"
				} }));
				else if (!res.writableEnded) res.destroy();
			});
			return;
		}
		if (pathname === OLLAMA_GENERATE_PATH && req.method === "POST") {
			readBody(req).then((raw) => require_ollama.handleOllamaGenerate(req, res, raw, fixtures, journal, defaults, setCorsHeaders)).catch((err) => {
				const msg = err instanceof Error ? err.message : "Internal error";
				if (!res.headersSent) require_sse_writer.writeErrorResponse(res, 500, JSON.stringify({ error: {
					message: msg,
					type: "server_error"
				} }));
				else if (!res.writableEnded) res.destroy();
			});
			return;
		}
		if (pathname === OLLAMA_TAGS_PATH && req.method === "GET") {
			setCorsHeaders(res);
			const modelIds = /* @__PURE__ */ new Set();
			for (const f of fixtures) if (f.match.model && typeof f.match.model === "string") modelIds.add(f.match.model);
			const models = (modelIds.size > 0 ? [...modelIds] : DEFAULT_MODELS).map((name) => ({
				name,
				model: name,
				modified_at: (/* @__PURE__ */ new Date()).toISOString(),
				size: 0,
				digest: "",
				details: {}
			}));
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ models }));
			return;
		}
		if (pathname !== COMPLETIONS_PATH) {
			handleNotFound(res, "Not found");
			return;
		}
		if (req.method !== "POST") {
			handleNotFound(res, "Not found");
			return;
		}
		handleCompletions(req, res, fixtures, journal, defaults, azureDeploymentId, azureDeploymentId ? "azure" : "openai").catch((err) => {
			const msg = err instanceof Error ? err.message : "Internal error";
			if (!res.headersSent) require_sse_writer.writeErrorResponse(res, 500, JSON.stringify({ error: {
				message: msg,
				type: "server_error"
			} }));
			else if (!res.writableEnded) {
				try {
					res.write(`data: ${JSON.stringify({ error: {
						message: msg,
						type: "server_error"
					} })}\n\n`);
				} catch (writeErr) {
					logger.debug("Failed to write error recovery response:", writeErr);
				}
				res.end();
			}
		});
	});
	const activeConnections = /* @__PURE__ */ new Set();
	server.on("upgrade", (req, socket, head) => {
		const parsedUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
		const pathname = parsedUrl.pathname;
		if (pathname !== RESPONSES_PATH && pathname !== REALTIME_PATH && pathname !== GEMINI_LIVE_PATH) {
			socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
			socket.destroy();
			return;
		}
		if (head.length > 0) socket.unshift(head);
		let ws;
		try {
			ws = require_ws_framing.upgradeToWebSocket(req, socket);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "WebSocket upgrade failed";
			logger.error(`WebSocket upgrade error: ${msg}`);
			if (!socket.destroyed) socket.destroy();
			return;
		}
		activeConnections.add(ws);
		ws.on("error", (err) => {
			logger.error(`WebSocket error: ${err.message}`);
			activeConnections.delete(ws);
		});
		ws.on("close", () => {
			activeConnections.delete(ws);
		});
		if (pathname === RESPONSES_PATH) require_ws_responses.handleWebSocketResponses(ws, fixtures, journal, {
			...defaults,
			model: "gpt-4"
		});
		else if (pathname === REALTIME_PATH) {
			const model = parsedUrl.searchParams.get("model") ?? "gpt-4o-realtime";
			require_ws_realtime.handleWebSocketRealtime(ws, fixtures, journal, {
				...defaults,
				model
			});
		} else if (pathname === GEMINI_LIVE_PATH) require_ws_gemini_live.handleWebSocketGeminiLive(ws, fixtures, journal, {
			...defaults,
			model: "gemini-2.0-flash"
		});
	});
	const originalClose = server.close.bind(server);
	server.close = function(callback) {
		for (const ws of activeConnections) ws.close(1001, "Server shutting down");
		activeConnections.clear();
		originalClose(callback);
		return this;
	};
	return new Promise((resolve, reject) => {
		server.on("error", reject);
		server.listen(port, host, () => {
			const addr = server.address();
			if (!addr || typeof addr === "string") {
				reject(/* @__PURE__ */ new Error("Unexpected address format"));
				return;
			}
			resolve({
				server,
				journal,
				url: `http://${addr.address}:${addr.port}`,
				defaults
			});
		});
	});
}

//#endregion
exports.createServer = createServer;
//# sourceMappingURL=server.cjs.map