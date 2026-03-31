//#region src/sse-writer.ts
function delay(ms, signal) {
	if (ms <= 0 || signal?.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener("abort", () => {
			clearTimeout(timer);
			resolve();
		}, { once: true });
	});
}
function calculateDelay(chunkIndex, profile, fallbackLatency) {
	if (!profile) return fallbackLatency ?? 0;
	let delayMs;
	if (chunkIndex === 0 && profile.ttft !== void 0) delayMs = profile.ttft;
	else if (profile.tps !== void 0 && profile.tps > 0) delayMs = 1e3 / profile.tps;
	else return fallbackLatency ?? 0;
	if (profile.jitter && profile.jitter > 0) delayMs *= 1 + (Math.random() * 2 - 1) * profile.jitter;
	return Math.max(0, delayMs);
}
async function writeSSEStream(res, chunks, optionsOrLatency) {
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
	if (!res.writableEnded) {
		res.write("data: [DONE]\n\n");
		res.end();
	}
	return true;
}
function writeErrorResponse(res, status, body) {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(body);
}

//#endregion
export { calculateDelay, delay, writeErrorResponse, writeSSEStream };
//# sourceMappingURL=sse-writer.js.map