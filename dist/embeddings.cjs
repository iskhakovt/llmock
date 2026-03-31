const require_helpers = require('./helpers.cjs');
const require_router = require('./router.cjs');
const require_sse_writer = require('./sse-writer.cjs');
const require_chaos = require('./chaos.cjs');
const require_recorder = require('./recorder.cjs');

//#region src/embeddings.ts
async function handleEmbeddings(req, res, raw, fixtures, journal, defaults, setCorsHeaders) {
	const { logger } = defaults;
	setCorsHeaders(res);
	let embeddingReq;
	try {
		embeddingReq = JSON.parse(raw);
	} catch {
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v1/embeddings",
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
	const inputs = Array.isArray(embeddingReq.input) ? embeddingReq.input : [embeddingReq.input];
	const combinedInput = inputs.join(" ");
	const syntheticReq = {
		model: embeddingReq.model,
		messages: [],
		embeddingInput: combinedInput
	};
	const fixture = require_router.matchFixture(fixtures, syntheticReq, journal.fixtureMatchCounts, defaults.requestTransform);
	if (fixture) journal.incrementFixtureMatchCount(fixture, fixtures);
	if (require_chaos.applyChaos(res, fixture, defaults.chaos, req.headers, journal, {
		method: req.method ?? "POST",
		path: req.url ?? "/v1/embeddings",
		headers: require_helpers.flattenHeaders(req.headers),
		body: syntheticReq
	}, defaults.registry, defaults.logger)) return;
	if (fixture) {
		const response = fixture.response;
		if (require_helpers.isErrorResponse(response)) {
			const status = response.status ?? 500;
			journal.add({
				method: req.method ?? "POST",
				path: req.url ?? "/v1/embeddings",
				headers: require_helpers.flattenHeaders(req.headers),
				body: syntheticReq,
				response: {
					status,
					fixture
				}
			});
			require_sse_writer.writeErrorResponse(res, status, JSON.stringify(response));
			return;
		}
		if (require_helpers.isEmbeddingResponse(response)) {
			journal.add({
				method: req.method ?? "POST",
				path: req.url ?? "/v1/embeddings",
				headers: require_helpers.flattenHeaders(req.headers),
				body: syntheticReq,
				response: {
					status: 200,
					fixture
				}
			});
			const body = require_helpers.buildEmbeddingResponse(inputs.map(() => [...response.embedding]), embeddingReq.model);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
			return;
		}
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v1/embeddings",
			headers: require_helpers.flattenHeaders(req.headers),
			body: syntheticReq,
			response: {
				status: 500,
				fixture
			}
		});
		require_sse_writer.writeErrorResponse(res, 500, JSON.stringify({ error: {
			message: "Fixture response did not match any known embedding type (must have embedding or error)",
			type: "server_error"
		} }));
		return;
	}
	if (defaults.record) {
		if (await require_recorder.proxyAndRecord(req, res, syntheticReq, "openai", req.url ?? "/v1/embeddings", fixtures, defaults, raw)) {
			journal.add({
				method: req.method ?? "POST",
				path: req.url ?? "/v1/embeddings",
				headers: require_helpers.flattenHeaders(req.headers),
				body: syntheticReq,
				response: {
					status: res.statusCode ?? 200,
					fixture: null
				}
			});
			return;
		}
	}
	if (defaults.strict) {
		logger.error(`STRICT: No fixture matched for ${req.method ?? "POST"} ${req.url ?? "/v1/embeddings"}`);
		journal.add({
			method: req.method ?? "POST",
			path: req.url ?? "/v1/embeddings",
			headers: require_helpers.flattenHeaders(req.headers),
			body: syntheticReq,
			response: {
				status: 503,
				fixture: null
			}
		});
		require_sse_writer.writeErrorResponse(res, 503, JSON.stringify({ error: {
			message: "Strict mode: no fixture matched",
			type: "invalid_request_error",
			code: "no_fixture_match"
		} }));
		return;
	}
	logger.warn(`No embedding fixture matched for "${combinedInput.slice(0, 80)}" — returning deterministic fallback`);
	const dimensions = embeddingReq.dimensions ?? 1536;
	const embeddings = inputs.map((input) => require_helpers.generateDeterministicEmbedding(input, dimensions));
	journal.add({
		method: req.method ?? "POST",
		path: req.url ?? "/v1/embeddings",
		headers: require_helpers.flattenHeaders(req.headers),
		body: syntheticReq,
		response: {
			status: 200,
			fixture: null
		}
	});
	const body = require_helpers.buildEmbeddingResponse(embeddings, embeddingReq.model);
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
}

//#endregion
exports.handleEmbeddings = handleEmbeddings;
//# sourceMappingURL=embeddings.cjs.map