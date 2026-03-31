const require_runtime = require('./_virtual/_rolldown/runtime.cjs');
const require_helpers = require('./helpers.cjs');
let node_fs = require("node:fs");
let node_path = require("node:path");

//#region src/fixture-loader.ts
function entryToFixture(entry) {
	return {
		match: {
			userMessage: entry.match.userMessage,
			inputText: entry.match.inputText,
			toolCallId: entry.match.toolCallId,
			toolName: entry.match.toolName,
			model: entry.match.model,
			responseFormat: entry.match.responseFormat,
			...entry.match.sequenceIndex !== void 0 && { sequenceIndex: entry.match.sequenceIndex }
		},
		response: entry.response,
		...entry.latency !== void 0 && { latency: entry.latency },
		...entry.chunkSize !== void 0 && { chunkSize: entry.chunkSize },
		...entry.truncateAfterChunks !== void 0 && { truncateAfterChunks: entry.truncateAfterChunks },
		...entry.disconnectAfterMs !== void 0 && { disconnectAfterMs: entry.disconnectAfterMs },
		...entry.streamingProfile !== void 0 && { streamingProfile: entry.streamingProfile },
		...entry.chaos !== void 0 && { chaos: entry.chaos }
	};
}
function warn(logger, msg, ...rest) {
	if (logger) logger.warn(msg, ...rest);
	else console.warn(`[fixture-loader] ${msg}`, ...rest);
}
function loadFixtureFile(filePath, logger) {
	let raw;
	try {
		raw = (0, node_fs.readFileSync)(filePath, "utf-8");
	} catch (err) {
		warn(logger, `Could not read file ${filePath}:`, err);
		return [];
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (err) {
		warn(logger, `Invalid JSON in ${filePath}:`, err);
		return [];
	}
	if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.fixtures)) {
		warn(logger, `Missing or invalid "fixtures" array in ${filePath}`);
		return [];
	}
	return parsed.fixtures.map(entryToFixture);
}
function loadFixturesFromDir(dirPath, logger) {
	let entries;
	try {
		entries = (0, node_fs.readdirSync)(dirPath);
	} catch (err) {
		warn(logger, `Could not read directory ${dirPath}:`, err);
		return [];
	}
	const jsonFiles = [];
	for (const name of entries) {
		const fullPath = (0, node_path.join)(dirPath, name);
		try {
			if ((0, node_fs.statSync)(fullPath).isDirectory()) {
				warn(logger, `Skipping subdirectory ${fullPath} (fixtures are not loaded recursively)`);
				continue;
			}
		} catch (err) {
			if (err.code !== "ENOENT") warn(logger, `Could not stat ${fullPath}:`, err);
			continue;
		}
		if (name.endsWith(".json")) jsonFiles.push(name);
	}
	jsonFiles.sort();
	const fixtures = [];
	for (const name of jsonFiles) {
		const filePath = (0, node_path.join)(dirPath, name);
		fixtures.push(...loadFixtureFile(filePath, logger));
	}
	return fixtures;
}
function validateFixtures(fixtures) {
	const results = [];
	const seenUserMessages = /* @__PURE__ */ new Map();
	for (let i = 0; i < fixtures.length; i++) {
		const f = fixtures[i];
		const response = f.response;
		if (!require_helpers.isTextResponse(response) && !require_helpers.isToolCallResponse(response) && !require_helpers.isErrorResponse(response) && !require_helpers.isEmbeddingResponse(response)) results.push({
			severity: "error",
			fixtureIndex: i,
			message: "response is not a recognized type (must have content, toolCalls, error, or embedding)"
		});
		if (require_helpers.isTextResponse(response)) {
			if (response.content === "") results.push({
				severity: "error",
				fixtureIndex: i,
				message: "content is empty string"
			});
		}
		if (require_helpers.isToolCallResponse(response)) {
			if (response.toolCalls.length === 0) results.push({
				severity: "warning",
				fixtureIndex: i,
				message: "toolCalls array is empty — fixture will never produce tool calls"
			});
			for (let j = 0; j < response.toolCalls.length; j++) {
				const tc = response.toolCalls[j];
				if (!tc.name) results.push({
					severity: "error",
					fixtureIndex: i,
					message: `toolCalls[${j}].name is empty`
				});
				try {
					JSON.parse(tc.arguments);
				} catch {
					results.push({
						severity: "error",
						fixtureIndex: i,
						message: `toolCalls[${j}].arguments is not valid JSON: ${tc.arguments}`
					});
				}
			}
		}
		if (require_helpers.isErrorResponse(response)) {
			if (!response.error.message) results.push({
				severity: "error",
				fixtureIndex: i,
				message: "error.message is empty"
			});
			if (response.status !== void 0 && (response.status < 100 || response.status > 599)) results.push({
				severity: "error",
				fixtureIndex: i,
				message: `error status ${response.status} is not a valid HTTP status code`
			});
		}
		if (require_helpers.isEmbeddingResponse(response)) {
			if (response.embedding.length === 0) results.push({
				severity: "error",
				fixtureIndex: i,
				message: "embedding array is empty"
			});
			for (let j = 0; j < response.embedding.length; j++) if (typeof response.embedding[j] !== "number") {
				results.push({
					severity: "error",
					fixtureIndex: i,
					message: `embedding[${j}] is not a number`
				});
				break;
			}
		}
		if (f.latency !== void 0 && f.latency < 0) results.push({
			severity: "error",
			fixtureIndex: i,
			message: "latency must be >= 0"
		});
		if (f.chunkSize !== void 0 && f.chunkSize < 1) results.push({
			severity: "error",
			fixtureIndex: i,
			message: "chunkSize must be >= 1"
		});
		if (f.truncateAfterChunks !== void 0 && f.truncateAfterChunks < 1) results.push({
			severity: "error",
			fixtureIndex: i,
			message: "truncateAfterChunks must be >= 1"
		});
		if (f.disconnectAfterMs !== void 0 && f.disconnectAfterMs < 0) results.push({
			severity: "error",
			fixtureIndex: i,
			message: "disconnectAfterMs must be >= 0"
		});
		if (f.streamingProfile !== void 0) {
			const sp = f.streamingProfile;
			if (sp.ttft !== void 0 && sp.ttft < 0) results.push({
				severity: "error",
				fixtureIndex: i,
				message: "streamingProfile.ttft must be >= 0"
			});
			if (sp.tps !== void 0 && sp.tps <= 0) results.push({
				severity: "error",
				fixtureIndex: i,
				message: "streamingProfile.tps must be > 0"
			});
			if (sp.jitter !== void 0 && (sp.jitter < 0 || sp.jitter > 1)) results.push({
				severity: "error",
				fixtureIndex: i,
				message: "streamingProfile.jitter must be between 0 and 1"
			});
		}
		if (f.chaos !== void 0) {
			const ch = f.chaos;
			if (ch.dropRate !== void 0 && (ch.dropRate < 0 || ch.dropRate > 1)) results.push({
				severity: "error",
				fixtureIndex: i,
				message: "chaos.dropRate must be between 0 and 1"
			});
			if (ch.malformedRate !== void 0 && (ch.malformedRate < 0 || ch.malformedRate > 1)) results.push({
				severity: "error",
				fixtureIndex: i,
				message: "chaos.malformedRate must be between 0 and 1"
			});
			if (ch.disconnectRate !== void 0 && (ch.disconnectRate < 0 || ch.disconnectRate > 1)) results.push({
				severity: "error",
				fixtureIndex: i,
				message: "chaos.disconnectRate must be between 0 and 1"
			});
		}
		const um = f.match.userMessage;
		if (typeof um === "string" && um) {
			const prev = seenUserMessages.get(um);
			if (prev !== void 0) results.push({
				severity: "warning",
				fixtureIndex: i,
				message: `duplicate userMessage '${um}' — shadows fixture ${prev}`
			});
			else seenUserMessages.set(um, i);
		}
		const match = f.match;
		if (!(match.userMessage !== void 0 || match.inputText !== void 0 || match.responseFormat !== void 0 || match.toolCallId !== void 0 || match.toolName !== void 0 || match.model !== void 0 || match.predicate !== void 0) && i < fixtures.length - 1) results.push({
			severity: "warning",
			fixtureIndex: i,
			message: `empty match acts as catch-all but is not the last fixture — shadows fixtures ${i + 1}+`
		});
	}
	return results;
}

//#endregion
exports.loadFixtureFile = loadFixtureFile;
exports.loadFixturesFromDir = loadFixturesFromDir;
exports.validateFixtures = validateFixtures;
//# sourceMappingURL=fixture-loader.cjs.map