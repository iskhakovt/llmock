const require_helpers = require('./helpers.cjs');

//#region src/journal.ts
/**
* Compare two field values, handling RegExp by source+flags rather than reference.
*/
function fieldEqual(a, b) {
	if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source && a.flags === b.flags;
	return a === b;
}
/**
* Check whether two fixture match objects have the same criteria
* (ignoring sequenceIndex). Used to group sequenced fixtures.
*/
function matchCriteriaEqual(a, b) {
	return fieldEqual(a.userMessage, b.userMessage) && fieldEqual(a.inputText, b.inputText) && fieldEqual(a.toolCallId, b.toolCallId) && fieldEqual(a.toolName, b.toolName) && fieldEqual(a.model, b.model) && fieldEqual(a.responseFormat, b.responseFormat) && fieldEqual(a.predicate, b.predicate);
}
var Journal = class {
	entries = [];
	fixtureMatchCounts = /* @__PURE__ */ new Map();
	add(entry) {
		const full = {
			id: require_helpers.generateId("req"),
			timestamp: Date.now(),
			...entry
		};
		this.entries.push(full);
		return full;
	}
	getAll(opts) {
		if (opts?.limit !== void 0) return this.entries.slice(-opts.limit);
		return this.entries.slice();
	}
	getLast() {
		return this.entries.length > 0 ? this.entries[this.entries.length - 1] : null;
	}
	findByFixture(fixture) {
		return this.entries.filter((e) => e.response.fixture === fixture);
	}
	getFixtureMatchCount(fixture) {
		return this.fixtureMatchCounts.get(fixture) ?? 0;
	}
	incrementFixtureMatchCount(fixture, allFixtures) {
		this.fixtureMatchCounts.set(fixture, this.getFixtureMatchCount(fixture) + 1);
		if (fixture.match.sequenceIndex !== void 0 && allFixtures) for (const sibling of allFixtures) {
			if (sibling === fixture) continue;
			if (sibling.match.sequenceIndex === void 0) continue;
			if (matchCriteriaEqual(fixture.match, sibling.match)) this.fixtureMatchCounts.set(sibling, this.getFixtureMatchCount(sibling) + 1);
		}
	}
	clearMatchCounts() {
		this.fixtureMatchCounts.clear();
	}
	clear() {
		this.entries = [];
		this.fixtureMatchCounts.clear();
	}
	get size() {
		return this.entries.length;
	}
};

//#endregion
exports.Journal = Journal;
//# sourceMappingURL=journal.cjs.map