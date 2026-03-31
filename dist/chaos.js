import { writeErrorResponse } from "./sse-writer.js";

//#region src/chaos.ts
/**
* Resolve chaos config from headers, fixture, and server defaults.
* Header values override fixture values, which override server defaults.
*/
function resolveChaosConfig(fixture, serverDefaults, rawHeaders, logger) {
	const base = { ...serverDefaults };
	if (fixture?.chaos) {
		if (fixture.chaos.dropRate !== void 0) base.dropRate = fixture.chaos.dropRate;
		if (fixture.chaos.malformedRate !== void 0) base.malformedRate = fixture.chaos.malformedRate;
		if (fixture.chaos.disconnectRate !== void 0) base.disconnectRate = fixture.chaos.disconnectRate;
	}
	if (rawHeaders) {
		const dropHeader = rawHeaders["x-llmock-chaos-drop"];
		const malformedHeader = rawHeaders["x-llmock-chaos-malformed"];
		const disconnectHeader = rawHeaders["x-llmock-chaos-disconnect"];
		if (typeof dropHeader === "string") {
			const val = parseFloat(dropHeader);
			if (isNaN(val)) logger?.warn(`[chaos] x-llmock-chaos-drop: invalid value "${dropHeader}", ignoring`);
			else {
				if (val < 0 || val > 1) logger?.warn(`[chaos] x-llmock-chaos-drop: value ${val} out of range [0,1], clamping`);
				base.dropRate = Math.min(1, Math.max(0, val));
			}
		}
		if (typeof malformedHeader === "string") {
			const val = parseFloat(malformedHeader);
			if (isNaN(val)) logger?.warn(`[chaos] x-llmock-chaos-malformed: invalid value "${malformedHeader}", ignoring`);
			else {
				if (val < 0 || val > 1) logger?.warn(`[chaos] x-llmock-chaos-malformed: value ${val} out of range [0,1], clamping`);
				base.malformedRate = Math.min(1, Math.max(0, val));
			}
		}
		if (typeof disconnectHeader === "string") {
			const val = parseFloat(disconnectHeader);
			if (isNaN(val)) logger?.warn(`[chaos] x-llmock-chaos-disconnect: invalid value "${disconnectHeader}", ignoring`);
			else {
				if (val < 0 || val > 1) logger?.warn(`[chaos] x-llmock-chaos-disconnect: value ${val} out of range [0,1], clamping`);
				base.disconnectRate = Math.min(1, Math.max(0, val));
			}
		}
	}
	if (base.dropRate !== void 0) base.dropRate = Math.min(1, Math.max(0, base.dropRate));
	if (base.malformedRate !== void 0) base.malformedRate = Math.min(1, Math.max(0, base.malformedRate));
	if (base.disconnectRate !== void 0) base.disconnectRate = Math.min(1, Math.max(0, base.disconnectRate));
	return base;
}
/**
* Evaluate chaos config and return the triggered action, or null if none.
* Checks in order: drop, malformed, disconnect — first hit wins.
*/
function evaluateChaos(fixture, serverDefaults, rawHeaders, logger) {
	const config = resolveChaosConfig(fixture, serverDefaults, rawHeaders, logger);
	if (config.dropRate !== void 0 && config.dropRate > 0 && Math.random() < config.dropRate) return "drop";
	if (config.malformedRate !== void 0 && config.malformedRate > 0 && Math.random() < config.malformedRate) return "malformed";
	if (config.disconnectRate !== void 0 && config.disconnectRate > 0 && Math.random() < config.disconnectRate) return "disconnect";
	return null;
}
/**
* Apply chaos to a request. Returns true if chaos was applied (caller should
* return early), false if the request should proceed normally.
*/
function applyChaos(res, fixture, serverDefaults, rawHeaders, journal, context, registry, logger) {
	const action = evaluateChaos(fixture, serverDefaults, rawHeaders, logger);
	if (!action) return false;
	if (registry) registry.incrementCounter("llmock_chaos_triggered_total", { action });
	switch (action) {
		case "drop":
			journal.add({
				...context,
				response: {
					status: 500,
					fixture,
					chaosAction: "drop"
				}
			});
			writeErrorResponse(res, 500, JSON.stringify({ error: {
				message: "Chaos: request dropped",
				type: "server_error",
				code: "chaos_drop"
			} }));
			return true;
		case "malformed":
			journal.add({
				...context,
				response: {
					status: 200,
					fixture,
					chaosAction: "malformed"
				}
			});
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end("{malformed json: <<<chaos>>>");
			return true;
		case "disconnect":
			journal.add({
				...context,
				response: {
					status: 0,
					fixture,
					chaosAction: "disconnect"
				}
			});
			res.destroy();
			return true;
		default: return false;
	}
}

//#endregion
export { applyChaos, evaluateChaos };
//# sourceMappingURL=chaos.js.map