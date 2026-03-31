
//#region src/logger.ts
const LEVELS = {
	silent: 0,
	info: 1,
	debug: 2
};
var Logger = class {
	level;
	constructor(level = "silent") {
		this.level = LEVELS[level];
	}
	info(...args) {
		if (this.level >= LEVELS.info) console.log("[llmock]", ...args);
	}
	debug(...args) {
		if (this.level >= LEVELS.debug) console.log("[llmock]", ...args);
	}
	warn(...args) {
		console.warn("[llmock]", ...args);
	}
	error(...args) {
		console.error("[llmock]", ...args);
	}
};

//#endregion
exports.Logger = Logger;
//# sourceMappingURL=logger.cjs.map