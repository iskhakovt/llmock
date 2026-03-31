const require_runtime = require('./_virtual/_rolldown/runtime.cjs');
let node_crypto = require("node:crypto");

//#region src/helpers.ts
const REDACTED_HEADERS = new Set([
	"authorization",
	"x-api-key",
	"api-key"
]);
function flattenHeaders(headers) {
	const flat = {};
	for (const [key, value] of Object.entries(headers)) {
		if (value === void 0) continue;
		if (REDACTED_HEADERS.has(key.toLowerCase())) flat[key] = "[REDACTED]";
		else flat[key] = Array.isArray(value) ? value.join(", ") : value;
	}
	return flat;
}
function generateId(prefix = "chatcmpl") {
	return `${prefix}-${(0, node_crypto.randomBytes)(12).toString("base64url")}`;
}
function generateToolCallId() {
	return `call_${(0, node_crypto.randomBytes)(12).toString("base64url")}`;
}
function generateMessageId() {
	return `msg_${(0, node_crypto.randomBytes)(12).toString("base64url")}`;
}
function generateToolUseId() {
	return `toolu_${(0, node_crypto.randomBytes)(12).toString("base64url")}`;
}
function isTextResponse(r) {
	return "content" in r && typeof r.content === "string";
}
function isToolCallResponse(r) {
	return "toolCalls" in r && Array.isArray(r.toolCalls);
}
function isErrorResponse(r) {
	return "error" in r && r.error !== null && typeof r.error === "object";
}
function isEmbeddingResponse(r) {
	return "embedding" in r && Array.isArray(r.embedding);
}
function buildTextChunks(content, model, chunkSize) {
	const id = generateId();
	const created = Math.floor(Date.now() / 1e3);
	const chunks = [];
	chunks.push({
		id,
		object: "chat.completion.chunk",
		created,
		model,
		choices: [{
			index: 0,
			delta: {
				role: "assistant",
				content: ""
			},
			finish_reason: null
		}]
	});
	for (let i = 0; i < content.length; i += chunkSize) {
		const slice = content.slice(i, i + chunkSize);
		chunks.push({
			id,
			object: "chat.completion.chunk",
			created,
			model,
			choices: [{
				index: 0,
				delta: { content: slice },
				finish_reason: null
			}]
		});
	}
	chunks.push({
		id,
		object: "chat.completion.chunk",
		created,
		model,
		choices: [{
			index: 0,
			delta: {},
			finish_reason: "stop"
		}]
	});
	return chunks;
}
function buildToolCallChunks(toolCalls, model, chunkSize) {
	const id = generateId();
	const created = Math.floor(Date.now() / 1e3);
	const chunks = [];
	chunks.push({
		id,
		object: "chat.completion.chunk",
		created,
		model,
		choices: [{
			index: 0,
			delta: {
				role: "assistant",
				content: null
			},
			finish_reason: null
		}]
	});
	for (let tcIdx = 0; tcIdx < toolCalls.length; tcIdx++) {
		const tc = toolCalls[tcIdx];
		const tcId = tc.id || generateToolCallId();
		chunks.push({
			id,
			object: "chat.completion.chunk",
			created,
			model,
			choices: [{
				index: 0,
				delta: { tool_calls: [{
					index: tcIdx,
					id: tcId,
					type: "function",
					function: {
						name: tc.name,
						arguments: ""
					}
				}] },
				finish_reason: null
			}]
		});
		const args = tc.arguments;
		for (let i = 0; i < args.length; i += chunkSize) {
			const slice = args.slice(i, i + chunkSize);
			chunks.push({
				id,
				object: "chat.completion.chunk",
				created,
				model,
				choices: [{
					index: 0,
					delta: { tool_calls: [{
						index: tcIdx,
						function: { arguments: slice }
					}] },
					finish_reason: null
				}]
			});
		}
	}
	chunks.push({
		id,
		object: "chat.completion.chunk",
		created,
		model,
		choices: [{
			index: 0,
			delta: {},
			finish_reason: "tool_calls"
		}]
	});
	return chunks;
}
function buildTextCompletion(content, model) {
	return {
		id: generateId(),
		object: "chat.completion",
		created: Math.floor(Date.now() / 1e3),
		model,
		choices: [{
			index: 0,
			message: {
				role: "assistant",
				content,
				refusal: null
			},
			finish_reason: "stop"
		}],
		usage: {
			prompt_tokens: 0,
			completion_tokens: 0,
			total_tokens: 0
		}
	};
}
function buildToolCallCompletion(toolCalls, model) {
	return {
		id: generateId(),
		object: "chat.completion",
		created: Math.floor(Date.now() / 1e3),
		model,
		choices: [{
			index: 0,
			message: {
				role: "assistant",
				content: null,
				refusal: null,
				tool_calls: toolCalls.map((tc) => ({
					id: tc.id || generateToolCallId(),
					type: "function",
					function: {
						name: tc.name,
						arguments: tc.arguments
					}
				}))
			},
			finish_reason: "tool_calls"
		}],
		usage: {
			prompt_tokens: 0,
			completion_tokens: 0,
			total_tokens: 0
		}
	};
}
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
/**
* Generate a deterministic embedding vector from input text.
* Hashes the input with SHA-256 and spreads the hash bytes across
* the requested number of dimensions, producing values in [-1, 1].
*/
function generateDeterministicEmbedding(input, dimensions = DEFAULT_EMBEDDING_DIMENSIONS) {
	let currentHash = (0, node_crypto.createHash)("sha256").update(input).digest();
	const embedding = new Array(dimensions);
	for (let i = 0; i < dimensions; i++) {
		if (i > 0 && i % 32 === 0) currentHash = (0, node_crypto.createHash)("sha256").update(currentHash).digest();
		embedding[i] = currentHash[i % 32] / 127.5 - 1;
	}
	return embedding;
}
/**
* Build an OpenAI-format embeddings API response for one or more inputs.
*/
function buildEmbeddingResponse(embeddings, model) {
	return {
		object: "list",
		data: embeddings.map((embedding, index) => ({
			object: "embedding",
			index,
			embedding
		})),
		model,
		usage: {
			prompt_tokens: 0,
			total_tokens: 0
		}
	};
}

//#endregion
exports.buildEmbeddingResponse = buildEmbeddingResponse;
exports.buildTextChunks = buildTextChunks;
exports.buildTextCompletion = buildTextCompletion;
exports.buildToolCallChunks = buildToolCallChunks;
exports.buildToolCallCompletion = buildToolCallCompletion;
exports.flattenHeaders = flattenHeaders;
exports.generateDeterministicEmbedding = generateDeterministicEmbedding;
exports.generateId = generateId;
exports.generateMessageId = generateMessageId;
exports.generateToolCallId = generateToolCallId;
exports.generateToolUseId = generateToolUseId;
exports.isEmbeddingResponse = isEmbeddingResponse;
exports.isErrorResponse = isErrorResponse;
exports.isTextResponse = isTextResponse;
exports.isToolCallResponse = isToolCallResponse;
//# sourceMappingURL=helpers.cjs.map