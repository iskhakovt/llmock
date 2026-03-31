import { isErrorResponse, isTextResponse, isToolCallResponse } from "./helpers.js";
import { matchFixture } from "./router.js";
import { delay } from "./sse-writer.js";
import { createInterruptionSignal } from "./interruption.js";

//#region src/ws-gemini-live.ts
const WS_PATH = "/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
/**
* Convert Gemini Live turns into ChatMessage[] for fixture matching.
*/
function geminiTurnsToMessages(turns) {
	const messages = [];
	for (const turn of turns) {
		const role = turn.role ?? "user";
		if (role === "user") {
			const funcResponses = turn.parts.filter((p) => p.functionResponse);
			const textParts = turn.parts.filter((p) => p.text !== void 0);
			if (funcResponses.length > 0) {
				for (let i = 0; i < funcResponses.length; i++) {
					const fr = funcResponses[i].functionResponse;
					messages.push({
						role: "tool",
						content: typeof fr.response === "string" ? fr.response : JSON.stringify(fr.response),
						tool_call_id: fr.id ?? `call_gemini_${fr.name}_${i}`
					});
				}
				if (textParts.length > 0) messages.push({
					role: "user",
					content: textParts.map((p) => p.text).join("")
				});
			} else {
				const text = textParts.map((p) => p.text).join("");
				messages.push({
					role: "user",
					content: text
				});
			}
		} else if (role === "model") {
			const funcCalls = turn.parts.filter((p) => p.functionCall);
			const textParts = turn.parts.filter((p) => p.text !== void 0);
			if (funcCalls.length > 0) messages.push({
				role: "assistant",
				content: null,
				tool_calls: funcCalls.map((p, i) => ({
					id: `call_gemini_${p.functionCall.name}_${i}`,
					type: "function",
					function: {
						name: p.functionCall.name,
						arguments: JSON.stringify(p.functionCall.args)
					}
				}))
			});
			else {
				const text = textParts.map((p) => p.text).join("");
				messages.push({
					role: "assistant",
					content: text
				});
			}
		}
	}
	return messages;
}
/**
* Convert toolResponse messages into ChatMessage[] for fixture matching.
*/
function toolResponseToMessages(toolResponse) {
	return toolResponse.functionResponses.map((fr, i) => ({
		role: "tool",
		content: typeof fr.response === "string" ? fr.response : JSON.stringify(fr.response),
		tool_call_id: fr.id ?? `call_gemini_${fr.name}_${i}`
	}));
}
/**
* Convert Gemini tool definitions to ChatCompletion ToolDefinition[].
*/
function convertTools(geminiTools) {
	if (!geminiTools || geminiTools.length === 0) return [];
	return geminiTools.flatMap((t) => t.functionDeclarations ?? []).map((d) => ({
		type: "function",
		function: {
			name: d.name,
			description: d.description,
			parameters: d.parameters
		}
	}));
}
function handleWebSocketGeminiLive(ws, fixtures, journal, defaults) {
	const { logger } = defaults;
	const session = {
		setupDone: false,
		model: defaults.model,
		tools: [],
		conversationHistory: []
	};
	let pending = Promise.resolve();
	ws.on("message", (raw) => {
		pending = pending.then(() => processMessage(raw, ws, fixtures, journal, defaults, session).catch((err) => {
			const msg = err instanceof Error ? err.message : "Internal error";
			logger.error(`WebSocket Gemini Live error: ${msg}`);
			try {
				ws.send(JSON.stringify({ error: {
					code: 500,
					message: msg,
					status: "INTERNAL"
				} }));
			} catch {}
		}));
	});
}
async function processMessage(raw, ws, fixtures, journal, defaults, session) {
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		ws.send(JSON.stringify({ error: {
			code: 400,
			message: "Malformed JSON",
			status: "INVALID_ARGUMENT"
		} }));
		return;
	}
	if (parsed.setup) {
		session.setupDone = true;
		session.model = parsed.setup.model ?? defaults.model;
		session.tools = convertTools(parsed.setup.tools);
		ws.send(JSON.stringify({ setupComplete: {} }));
		return;
	}
	if (!session.setupDone) {
		ws.send(JSON.stringify({ error: {
			code: 400,
			message: "Setup required",
			status: "FAILED_PRECONDITION"
		} }));
		return;
	}
	let newMessages;
	if (parsed.clientContent) {
		if (!parsed.clientContent.turns || !Array.isArray(parsed.clientContent.turns)) {
			ws.send(JSON.stringify({ error: {
				code: 400,
				message: "Missing 'turns' in clientContent",
				status: "INVALID_ARGUMENT"
			} }));
			return;
		}
		newMessages = geminiTurnsToMessages(parsed.clientContent.turns);
	} else if (parsed.toolResponse) {
		if (!parsed.toolResponse.functionResponses || !Array.isArray(parsed.toolResponse.functionResponses)) {
			ws.send(JSON.stringify({ error: {
				code: 400,
				message: "Missing 'functionResponses' in toolResponse",
				status: "INVALID_ARGUMENT"
			} }));
			return;
		}
		newMessages = toolResponseToMessages(parsed.toolResponse);
	} else {
		ws.send(JSON.stringify({ error: {
			code: 400,
			message: "Expected clientContent or toolResponse",
			status: "INVALID_ARGUMENT"
		} }));
		return;
	}
	const completionReq = {
		model: session.model,
		messages: [...session.conversationHistory, ...newMessages],
		stream: true,
		tools: session.tools.length > 0 ? session.tools : void 0
	};
	const fixture = matchFixture(fixtures, completionReq, journal.fixtureMatchCounts, defaults.requestTransform);
	const path = WS_PATH;
	if (fixture) journal.incrementFixtureMatchCount(fixture, fixtures);
	if (!fixture) {
		if (defaults.strict) {
			defaults.logger.warn(`STRICT: No fixture matched for WebSocket message`);
			ws.close(1008, "Strict mode: no fixture matched");
			return;
		}
		journal.add({
			method: "WS",
			path,
			headers: {},
			body: completionReq,
			response: {
				status: 404,
				fixture: null
			}
		});
		ws.send(JSON.stringify({ error: {
			code: 404,
			message: "No fixture matched",
			status: "NOT_FOUND"
		} }));
		return;
	}
	session.conversationHistory.push(...newMessages);
	const response = fixture.response;
	const latency = fixture.latency ?? defaults.latency;
	const chunkSize = Math.max(1, fixture.chunkSize ?? defaults.chunkSize);
	if (isErrorResponse(response)) {
		const status = response.status ?? 500;
		journal.add({
			method: "WS",
			path,
			headers: {},
			body: completionReq,
			response: {
				status,
				fixture
			}
		});
		ws.send(JSON.stringify({ error: {
			code: status,
			message: response.error.message,
			status: "ERROR"
		} }));
		return;
	}
	if (isTextResponse(response)) {
		const journalEntry = journal.add({
			method: "WS",
			path,
			headers: {},
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		const content = response.content;
		if (content.length === 0) {
			if (ws.isClosed) return;
			ws.send(JSON.stringify({ serverContent: {
				modelTurn: { parts: [{ text: "" }] },
				turnComplete: true
			} }));
			return;
		}
		const chunks = [];
		for (let i = 0; i < content.length; i += chunkSize) chunks.push(content.slice(i, i + chunkSize));
		const interruption = createInterruptionSignal(fixture);
		let interrupted = false;
		for (let i = 0; i < chunks.length; i++) {
			if (ws.isClosed) break;
			if (latency > 0) await delay(latency, interruption?.signal);
			if (interruption?.signal.aborted) {
				interrupted = true;
				break;
			}
			if (ws.isClosed) break;
			const isLast = i === chunks.length - 1;
			ws.send(JSON.stringify({ serverContent: {
				modelTurn: { parts: [{ text: chunks[i] }] },
				turnComplete: isLast
			} }));
			interruption?.tick();
			if (interruption?.signal.aborted) {
				interrupted = true;
				break;
			}
		}
		if (interrupted) {
			ws.destroy();
			journalEntry.response.interrupted = true;
			journalEntry.response.interruptReason = interruption?.reason();
			interruption?.cleanup();
			return;
		}
		interruption?.cleanup();
		session.conversationHistory.push({
			role: "assistant",
			content
		});
		return;
	}
	if (isToolCallResponse(response)) {
		const journalEntry = journal.add({
			method: "WS",
			path,
			headers: {},
			body: completionReq,
			response: {
				status: 200,
				fixture
			}
		});
		const interruption = createInterruptionSignal(fixture);
		if (ws.isClosed) {
			interruption?.cleanup();
			return;
		}
		if (latency > 0) await delay(latency, interruption?.signal);
		if (interruption?.signal.aborted) {
			ws.destroy();
			journalEntry.response.interrupted = true;
			journalEntry.response.interruptReason = interruption?.reason();
			interruption?.cleanup();
			return;
		}
		if (ws.isClosed) {
			interruption?.cleanup();
			return;
		}
		const functionCalls = response.toolCalls.map((tc, i) => {
			let argsObj;
			try {
				argsObj = JSON.parse(tc.arguments || "{}");
			} catch {
				defaults.logger.warn(`Malformed JSON in fixture tool call arguments for "${tc.name}": ${tc.arguments}`);
				argsObj = {};
			}
			return {
				name: tc.name,
				args: argsObj,
				id: tc.id ?? `call_gemini_${tc.name}_${i}`
			};
		});
		ws.send(JSON.stringify({ toolCall: { functionCalls } }));
		interruption?.tick();
		if (interruption?.signal.aborted) {
			ws.destroy();
			journalEntry.response.interrupted = true;
			journalEntry.response.interruptReason = interruption?.reason();
			interruption?.cleanup();
			return;
		}
		interruption?.cleanup();
		session.conversationHistory.push({
			role: "assistant",
			content: null,
			tool_calls: response.toolCalls.map((tc, i) => ({
				id: tc.id ?? `call_gemini_${tc.name}_${i}`,
				type: "function",
				function: {
					name: tc.name,
					arguments: tc.arguments
				}
			}))
		});
		return;
	}
	journal.add({
		method: "WS",
		path,
		headers: {},
		body: completionReq,
		response: {
			status: 500,
			fixture
		}
	});
	ws.send(JSON.stringify({ error: {
		code: 500,
		message: "Fixture response did not match any known type",
		status: "INTERNAL"
	} }));
}

//#endregion
export { handleWebSocketGeminiLive };
//# sourceMappingURL=ws-gemini-live.js.map