const require_server = require('./server.cjs');
const require_fixture_loader = require('./fixture-loader.cjs');

//#region src/llmock.ts
var LLMock = class LLMock {
	fixtures = [];
	serverInstance = null;
	options;
	constructor(options) {
		this.options = options ?? {};
	}
	addFixture(fixture) {
		this.fixtures.push(fixture);
		return this;
	}
	addFixtures(fixtures) {
		this.fixtures.push(...fixtures);
		return this;
	}
	prependFixture(fixture) {
		this.fixtures.unshift(fixture);
		return this;
	}
	getFixtures() {
		return this.fixtures;
	}
	loadFixtureFile(filePath) {
		this.fixtures.push(...require_fixture_loader.loadFixtureFile(filePath));
		return this;
	}
	loadFixtureDir(dirPath) {
		this.fixtures.push(...require_fixture_loader.loadFixturesFromDir(dirPath));
		return this;
	}
	clearFixtures() {
		this.fixtures.length = 0;
		return this;
	}
	on(match, response, opts) {
		return this.addFixture({
			match,
			response,
			...opts
		});
	}
	onMessage(pattern, response, opts) {
		return this.on({ userMessage: pattern }, response, opts);
	}
	onEmbedding(pattern, response, opts) {
		return this.on({ inputText: pattern }, response, opts);
	}
	onJsonOutput(pattern, jsonContent, opts) {
		const content = typeof jsonContent === "string" ? jsonContent : JSON.stringify(jsonContent);
		return this.on({
			userMessage: pattern,
			responseFormat: "json_object"
		}, { content }, opts);
	}
	onToolCall(name, response, opts) {
		return this.on({ toolName: name }, response, opts);
	}
	onToolResult(id, response, opts) {
		return this.on({ toolCallId: id }, response, opts);
	}
	/**
	* Queue a one-shot error that will be returned for the next matching
	* request, then automatically removed. Implemented as an internal fixture
	* with a `predicate` that always matches (so it fires first) and spliced
	* at the front of the fixture list.
	*/
	nextRequestError(status, errorBody) {
		const fixture = {
			match: { predicate: () => true },
			response: {
				error: {
					message: errorBody?.message ?? "Injected error",
					type: errorBody?.type ?? "server_error",
					code: errorBody?.code
				},
				status
			}
		};
		this.fixtures.unshift(fixture);
		const original = fixture.match.predicate;
		fixture.match.predicate = (req) => {
			const result = original(req);
			if (result) queueMicrotask(() => {
				const idx = this.fixtures.indexOf(fixture);
				if (idx !== -1) this.fixtures.splice(idx, 1);
			});
			return result;
		};
		return this;
	}
	getRequests() {
		return this.journal.getAll();
	}
	getLastRequest() {
		return this.journal.getLast();
	}
	clearRequests() {
		this.journal.clear();
	}
	resetMatchCounts() {
		if (this.serverInstance) this.serverInstance.journal.clearMatchCounts();
		return this;
	}
	setChaos(config) {
		this.options.chaos = config;
		return this;
	}
	clearChaos() {
		delete this.options.chaos;
		return this;
	}
	enableRecording(config) {
		this.options.record = config;
		return this;
	}
	disableRecording() {
		delete this.options.record;
		return this;
	}
	reset() {
		this.clearFixtures();
		if (this.serverInstance) this.serverInstance.journal.clear();
		return this;
	}
	async start() {
		if (this.serverInstance) throw new Error("Server already started");
		this.serverInstance = await require_server.createServer(this.fixtures, this.options);
		return this.serverInstance.url;
	}
	async stop() {
		if (!this.serverInstance) throw new Error("Server not started");
		const { server } = this.serverInstance;
		await new Promise((resolve, reject) => {
			server.close((err) => err ? reject(err) : resolve());
		});
		this.serverInstance = null;
	}
	get journal() {
		if (!this.serverInstance) throw new Error("Server not started");
		return this.serverInstance.journal;
	}
	get url() {
		if (!this.serverInstance) throw new Error("Server not started");
		return this.serverInstance.url;
	}
	get baseUrl() {
		return this.url;
	}
	get port() {
		const parsed = new URL(this.url);
		if (!parsed.port) throw new Error(`Server URL has no explicit port: ${this.url}`);
		return parseInt(parsed.port, 10);
	}
	static async create(options) {
		const instance = new LLMock(options);
		await instance.start();
		return instance;
	}
};

//#endregion
exports.LLMock = LLMock;
//# sourceMappingURL=llmock.cjs.map