import { watch } from "node:fs";

//#region src/watcher.ts
const DEBOUNCE_MS = 500;
function watchFixtures(fixturePath, fixtures, loadFn, opts) {
	const { logger, validate, validateFn } = opts;
	let debounceTimer = null;
	function reload() {
		logger.info(`File changed — reloading fixtures from ${fixturePath}...`);
		let newFixtures;
		try {
			newFixtures = loadFn();
		} catch (err) {
			logger.error("Failed to reload fixtures:", err);
			logger.error("Previous fixtures remain active. Fix the error and save again to retry.");
			return;
		}
		if (newFixtures.length === 0 && fixtures.length > 0) {
			logger.warn("Reload produced 0 fixtures — keeping previous fixtures. Check fixture file for errors.");
			return;
		}
		if (validate && validateFn) {
			const results = validateFn(newFixtures);
			const errors = results.filter((r) => r.severity === "error");
			const warnings = results.filter((r) => r.severity === "warning");
			for (const w of warnings) logger.warn(`Fixture ${w.fixtureIndex}: ${w.message}`);
			if (errors.length > 0) {
				for (const e of errors) logger.error(`Fixture ${e.fixtureIndex}: ${e.message}`);
				logger.error(`${errors.length} validation error(s) — keeping previous fixtures`);
				return;
			}
		}
		fixtures.length = 0;
		fixtures.push(...newFixtures);
		logger.info(`Reloaded ${newFixtures.length} fixture(s)`);
	}
	const watcher = watch(fixturePath, { recursive: true }, () => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(reload, DEBOUNCE_MS);
	});
	watcher.on("error", (err) => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = null;
		try {
			watcher.close();
		} catch {}
		logger.error(`File watcher error on ${fixturePath}: ${err.message}`);
		logger.error("Fixture auto-reload is no longer active. Restart the server to resume watching.");
	});
	return { close() {
		if (debounceTimer) clearTimeout(debounceTimer);
		watcher.close();
	} };
}

//#endregion
export { watchFixtures };
//# sourceMappingURL=watcher.js.map