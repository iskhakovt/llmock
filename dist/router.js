//#region src/router.ts
function getLastMessageByRole(messages, role) {
	for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === role) return messages[i];
	return null;
}
/**
* Extract the text content from a message's content field.
* Handles both plain string content and array-of-parts content
* (e.g. `[{type: "text", text: "..."}]` as sent by some SDKs).
*/
function getTextContent(content) {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const texts = content.filter((p) => p.type === "text" && typeof p.text === "string" && p.text !== "").map((p) => p.text);
		return texts.length > 0 ? texts.join("") : null;
	}
	return null;
}
function matchFixture(fixtures, req, matchCounts, requestTransform) {
	const effectiveReq = requestTransform ? requestTransform(req) : req;
	for (const fixture of fixtures) {
		const { match } = fixture;
		if (match.predicate !== void 0) {
			if (!match.predicate(req)) continue;
		}
		if (match.userMessage !== void 0) {
			const msg = getLastMessageByRole(effectiveReq.messages, "user");
			const text = msg ? getTextContent(msg.content) : null;
			if (!text) continue;
			if (typeof match.userMessage === "string") {
				if (requestTransform ? text !== match.userMessage : !text.includes(match.userMessage)) continue;
			} else if (!match.userMessage.test(text)) continue;
		}
		if (match.toolCallId !== void 0) {
			const msg = getLastMessageByRole(effectiveReq.messages, "tool");
			if (!msg || msg.tool_call_id !== match.toolCallId) continue;
		}
		if (match.toolName !== void 0) {
			if (!(effectiveReq.tools ?? []).some((t) => t.function.name === match.toolName)) continue;
		}
		if (match.inputText !== void 0) {
			const embeddingInput = effectiveReq.embeddingInput;
			if (!embeddingInput) continue;
			if (typeof match.inputText === "string") {
				if (requestTransform ? embeddingInput !== match.inputText : !embeddingInput.includes(match.inputText)) continue;
			} else if (!match.inputText.test(embeddingInput)) continue;
		}
		if (match.responseFormat !== void 0) {
			if (effectiveReq.response_format?.type !== match.responseFormat) continue;
		}
		if (match.model !== void 0) {
			if (typeof match.model === "string") {
				if (effectiveReq.model !== match.model) continue;
			} else if (!match.model.test(effectiveReq.model)) continue;
		}
		if (match.sequenceIndex !== void 0 && matchCounts !== void 0) {
			if ((matchCounts.get(fixture) ?? 0) !== match.sequenceIndex) continue;
		}
		return fixture;
	}
	return null;
}

//#endregion
export { getLastMessageByRole, getTextContent, matchFixture };
//# sourceMappingURL=router.js.map