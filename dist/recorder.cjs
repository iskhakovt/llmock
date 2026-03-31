const require_runtime = require('./_virtual/_rolldown/runtime.cjs');
const require_router = require('./router.cjs');
const require_sse_writer = require('./sse-writer.cjs');
const require_stream_collapse = require('./stream-collapse.cjs');
const require_url = require('./url.cjs');
let node_fs = require("node:fs");
node_fs = require_runtime.__toESM(node_fs);
let node_path = require("node:path");
node_path = require_runtime.__toESM(node_path);
let node_http = require("node:http");
node_http = require_runtime.__toESM(node_http);
let node_crypto = require("node:crypto");
node_crypto = require_runtime.__toESM(node_crypto);
let node_https = require("node:https");
node_https = require_runtime.__toESM(node_https);

//#region src/recorder.ts
/** Headers to strip when proxying — hop-by-hop (RFC 2616 §13.5.1) + client-set. */
const STRIP_HEADERS = new Set([
	"connection",
	"keep-alive",
	"transfer-encoding",
	"te",
	"trailer",
	"upgrade",
	"proxy-authorization",
	"proxy-authenticate",
	"host",
	"content-length",
	"cookie",
	"accept-encoding"
]);
/**
* Proxy an unmatched request to the real upstream provider, record the
* response as a fixture on disk and in memory, then relay the response
* back to the original client.
*
* Returns `true` if the request was proxied (provider configured),
* `false` if no upstream URL is configured for the given provider key.
*/
async function proxyAndRecord(req, res, request, providerKey, pathname, fixtures, defaults, rawBody) {
	const record = defaults.record;
	if (!record) return false;
	const upstreamUrl = record.providers[providerKey];
	if (!upstreamUrl) {
		defaults.logger.warn(`No upstream URL configured for provider "${providerKey}" — cannot proxy`);
		return false;
	}
	const fixturePath = record.fixturePath ?? "./fixtures/recorded";
	let target;
	try {
		target = require_url.resolveUpstreamUrl(upstreamUrl, pathname);
	} catch {
		defaults.logger.error(`Invalid upstream URL for provider "${providerKey}": ${upstreamUrl}`);
		require_sse_writer.writeErrorResponse(res, 502, JSON.stringify({ error: {
			message: `Invalid upstream URL: ${upstreamUrl}`,
			type: "proxy_error"
		} }));
		return true;
	}
	defaults.logger.warn(`NO FIXTURE MATCH — proxying to ${upstreamUrl}${pathname}`);
	const forwardHeaders = {};
	for (const [name, val] of Object.entries(req.headers)) if (val !== void 0 && !STRIP_HEADERS.has(name)) forwardHeaders[name] = Array.isArray(val) ? val.join(", ") : val;
	const requestBody = rawBody ?? JSON.stringify(request);
	let upstreamStatus;
	let upstreamHeaders;
	let upstreamBody;
	let rawBuffer;
	try {
		const result = await makeUpstreamRequest(target, forwardHeaders, requestBody);
		upstreamStatus = result.status;
		upstreamHeaders = result.headers;
		upstreamBody = result.body;
		rawBuffer = result.rawBuffer;
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown proxy error";
		defaults.logger.error(`Proxy request failed: ${msg}`);
		res.writeHead(502, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: {
			message: `Proxy to upstream failed: ${msg}`,
			type: "proxy_error"
		} }));
		return true;
	}
	const contentType = upstreamHeaders["content-type"];
	const ctString = Array.isArray(contentType) ? contentType.join(", ") : contentType ?? "";
	const isBinaryStream = ctString.toLowerCase().includes("application/vnd.amazon.eventstream");
	const collapsed = require_stream_collapse.collapseStreamingResponse(ctString, providerKey, isBinaryStream ? rawBuffer : upstreamBody, defaults.logger);
	let fixtureResponse;
	if (collapsed) {
		defaults.logger.warn(`Streaming response detected (${ctString}) — collapsing to fixture`);
		if (collapsed.truncated) defaults.logger.warn("Bedrock EventStream: CRC mismatch — response may be truncated");
		if (collapsed.droppedChunks && collapsed.droppedChunks > 0) defaults.logger.warn(`${collapsed.droppedChunks} chunk(s) dropped during stream collapse`);
		if (collapsed.content === "" && (!collapsed.toolCalls || collapsed.toolCalls.length === 0)) defaults.logger.warn("Stream collapse produced empty content — fixture may be incomplete");
		if (collapsed.toolCalls && collapsed.toolCalls.length > 0) {
			if (collapsed.content) defaults.logger.warn("Collapsed response has both content and toolCalls — preferring toolCalls");
			fixtureResponse = { toolCalls: collapsed.toolCalls };
		} else fixtureResponse = { content: collapsed.content ?? "" };
	} else {
		let parsedResponse = null;
		try {
			parsedResponse = JSON.parse(upstreamBody);
		} catch {
			defaults.logger.warn("Upstream response is not valid JSON — saving as error fixture");
		}
		let encodingFormat;
		try {
			encodingFormat = rawBody ? JSON.parse(rawBody).encoding_format : void 0;
		} catch {}
		fixtureResponse = buildFixtureResponse(parsedResponse, upstreamStatus, encodingFormat);
	}
	const fixtureMatch = buildFixtureMatch(defaults.requestTransform ? defaults.requestTransform(request) : request);
	const fixture = {
		match: fixtureMatch,
		response: fixtureResponse
	};
	const matchValues = Object.values(fixtureMatch);
	const isEmptyMatch = matchValues.length === 0 || matchValues.every((v) => v === void 0);
	if (isEmptyMatch) defaults.logger.warn("Recorded fixture has empty match criteria — skipping in-memory registration");
	const filename = `${providerKey}-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${node_crypto.randomUUID().slice(0, 8)}.json`;
	const filepath = node_path.join(fixturePath, filename);
	let writtenToDisk = false;
	try {
		node_fs.mkdirSync(fixturePath, { recursive: true });
		const warnings = [];
		if (isEmptyMatch) warnings.push("Empty match criteria — this fixture will not match any request");
		if (collapsed?.truncated) warnings.push("Stream response was truncated — fixture may be incomplete");
		const fileContent = { fixtures: [fixture] };
		if (warnings.length > 0) fileContent._warning = warnings.join("; ");
		node_fs.writeFileSync(filepath, JSON.stringify(fileContent, null, 2), "utf-8");
		writtenToDisk = true;
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown filesystem error";
		defaults.logger.error(`Failed to save fixture to disk: ${msg}`);
		res.setHeader("X-LLMock-Record-Error", msg);
	}
	if (writtenToDisk) {
		if (!isEmptyMatch) fixtures.push(fixture);
		defaults.logger.warn(`Response recorded → ${filepath}`);
	} else defaults.logger.warn(`Response relayed but NOT saved to disk — see error above`);
	const relayHeaders = {};
	if (ctString) relayHeaders["Content-Type"] = ctString;
	res.writeHead(upstreamStatus, relayHeaders);
	res.end(isBinaryStream ? rawBuffer : upstreamBody);
	return true;
}
function makeUpstreamRequest(target, headers, body) {
	return new Promise((resolve, reject) => {
		const transport = target.protocol === "https:" ? node_https : node_http;
		const UPSTREAM_TIMEOUT_MS = 3e4;
		const BODY_TIMEOUT_MS = 3e4;
		const req = transport.request(target, {
			method: "POST",
			timeout: UPSTREAM_TIMEOUT_MS,
			headers: {
				...headers,
				"Content-Length": Buffer.byteLength(body).toString()
			}
		}, (res) => {
			res.setTimeout(BODY_TIMEOUT_MS, () => {
				req.destroy(/* @__PURE__ */ new Error(`Upstream response timed out after ${BODY_TIMEOUT_MS / 1e3}s`));
			});
			const chunks = [];
			res.on("data", (chunk) => chunks.push(chunk));
			res.on("error", reject);
			res.on("end", () => {
				const rawBuffer = Buffer.concat(chunks);
				resolve({
					status: res.statusCode ?? 500,
					headers: res.headers,
					body: rawBuffer.toString(),
					rawBuffer
				});
			});
		});
		req.on("timeout", () => {
			req.destroy(/* @__PURE__ */ new Error(`Upstream request timed out after ${UPSTREAM_TIMEOUT_MS / 1e3}s: ${target.href}`));
		});
		req.on("error", reject);
		req.write(body);
		req.end();
	});
}
/**
* Detect the response format from the parsed upstream JSON and convert
* it into an llmock FixtureResponse.
*/
function buildFixtureResponse(parsed, status, encodingFormat) {
	if (parsed === null || parsed === void 0) return {
		error: {
			message: "Upstream returned non-JSON response",
			type: "proxy_error"
		},
		status
	};
	const obj = parsed;
	if (obj.error) {
		const err = obj.error;
		return {
			error: {
				message: String(err.message ?? "Unknown error"),
				type: String(err.type ?? "api_error"),
				code: err.code ? String(err.code) : void 0
			},
			status
		};
	}
	if (Array.isArray(obj.data) && obj.data.length > 0) {
		const first = obj.data[0];
		if (Array.isArray(first.embedding)) return { embedding: first.embedding };
		if (typeof first.embedding === "string" && encodingFormat === "base64") {
			const buf = Buffer.from(first.embedding, "base64");
			const floats = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
			return { embedding: Array.from(floats) };
		}
	}
	if (Array.isArray(obj.embedding)) return { embedding: obj.embedding };
	if (Array.isArray(obj.choices) && obj.choices.length > 0) {
		const message = obj.choices[0].message;
		if (message) {
			if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return { toolCalls: message.tool_calls.map((tc) => {
				const fn = tc.function;
				return {
					name: String(fn.name),
					arguments: String(fn.arguments)
				};
			}) };
			if (typeof message.content === "string") return { content: message.content };
		}
	}
	if (Array.isArray(obj.content) && obj.content.length > 0) {
		const blocks = obj.content;
		const toolUseBlocks = blocks.filter((b) => b.type === "tool_use");
		if (toolUseBlocks.length > 0) return { toolCalls: toolUseBlocks.map((b) => ({
			name: String(b.name),
			arguments: typeof b.input === "string" ? b.input : JSON.stringify(b.input)
		})) };
		const textBlock = blocks.find((b) => b.type === "text");
		if (textBlock && typeof textBlock.text === "string") return { content: textBlock.text };
	}
	if (Array.isArray(obj.candidates) && obj.candidates.length > 0) {
		const content = obj.candidates[0].content;
		if (content && Array.isArray(content.parts)) {
			const parts = content.parts;
			const fnCallParts = parts.filter((p) => p.functionCall);
			if (fnCallParts.length > 0) return { toolCalls: fnCallParts.map((p) => {
				const fc = p.functionCall;
				return {
					name: String(fc.name),
					arguments: typeof fc.args === "string" ? fc.args : JSON.stringify(fc.args)
				};
			}) };
			const textPart = parts.find((p) => typeof p.text === "string");
			if (textPart && typeof textPart.text === "string") return { content: textPart.text };
		}
	}
	if (obj.output && typeof obj.output === "object") {
		const msg = obj.output.message;
		if (msg && Array.isArray(msg.content)) {
			const blocks = msg.content;
			const toolUseBlocks = blocks.filter((b) => b.toolUse);
			if (toolUseBlocks.length > 0) return { toolCalls: toolUseBlocks.map((b) => {
				const tu = b.toolUse;
				return {
					name: String(tu.name ?? ""),
					arguments: typeof tu.input === "string" ? tu.input : JSON.stringify(tu.input)
				};
			}) };
			const textBlock = blocks.find((b) => typeof b.text === "string");
			if (textBlock && typeof textBlock.text === "string") return { content: textBlock.text };
		}
	}
	if (obj.message && typeof obj.message === "object") {
		const msg = obj.message;
		if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return { toolCalls: msg.tool_calls.filter((tc) => tc.function != null).map((tc) => {
			const fn = tc.function;
			return {
				name: String(fn.name ?? ""),
				arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments)
			};
		}) };
		if (typeof msg.content === "string" && msg.content.length > 0) return { content: msg.content };
		if (Array.isArray(msg.content) && msg.content.length > 0) {
			const first = msg.content[0];
			if (typeof first.text === "string") return { content: first.text };
		}
	}
	return {
		error: {
			message: "Could not detect response format from upstream",
			type: "proxy_error"
		},
		status
	};
}
/**
* Derive fixture match criteria from the original request.
*/
function buildFixtureMatch(request) {
	if (request.embeddingInput) return { inputText: request.embeddingInput };
	const lastUser = require_router.getLastMessageByRole(request.messages ?? [], "user");
	if (lastUser) {
		const text = require_router.getTextContent(lastUser.content);
		if (text) return { userMessage: text };
	}
	return {};
}

//#endregion
exports.proxyAndRecord = proxyAndRecord;
//# sourceMappingURL=recorder.cjs.map