import { calculateDelay, delay } from "./sse-writer.js";

//#region src/ndjson-writer.ts
async function writeNDJSONStream(res, chunks, options) {
	const opts = options ?? {};
	const latency = opts.latency ?? 0;
	const profile = opts.streamingProfile;
	const signal = opts.signal;
	const onChunkSent = opts.onChunkSent;
	if (res.writableEnded) return true;
	res.setHeader("Content-Type", "application/x-ndjson");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	let chunkIndex = 0;
	for (const chunk of chunks) {
		const chunkDelay = calculateDelay(chunkIndex, profile, latency);
		if (chunkDelay > 0) await delay(chunkDelay, signal);
		if (signal?.aborted) return false;
		if (res.writableEnded) return true;
		res.write(JSON.stringify(chunk) + "\n");
		onChunkSent?.();
		if (signal?.aborted) return false;
		chunkIndex++;
	}
	if (!res.writableEnded) res.end();
	return true;
}

//#endregion
export { writeNDJSONStream };
//# sourceMappingURL=ndjson-writer.js.map