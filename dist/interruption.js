//#region src/interruption.ts
function createInterruptionSignal(fixture) {
	const { truncateAfterChunks, disconnectAfterMs } = fixture;
	if (truncateAfterChunks === void 0 && disconnectAfterMs === void 0) return null;
	const controller = new AbortController();
	let abortReason;
	let chunkCount = 0;
	let timer;
	if (disconnectAfterMs !== void 0) timer = setTimeout(() => {
		if (!controller.signal.aborted) {
			abortReason = "disconnectAfterMs";
			controller.abort();
		}
	}, disconnectAfterMs);
	return {
		signal: controller.signal,
		tick() {
			if (controller.signal.aborted) return;
			chunkCount++;
			if (truncateAfterChunks !== void 0 && chunkCount >= truncateAfterChunks) {
				abortReason = "truncateAfterChunks";
				controller.abort();
			}
		},
		cleanup() {
			if (timer !== void 0) {
				clearTimeout(timer);
				timer = void 0;
			}
		},
		reason() {
			return abortReason;
		}
	};
}

//#endregion
export { createInterruptionSignal };
//# sourceMappingURL=interruption.js.map