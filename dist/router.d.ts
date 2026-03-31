import { ChatCompletionRequest, ContentPart, Fixture } from "./types.js";

//#region src/router.d.ts

/**
 * Extract the text content from a message's content field.
 * Handles both plain string content and array-of-parts content
 * (e.g. `[{type: "text", text: "..."}]` as sent by some SDKs).
 */
declare function getTextContent(content: string | ContentPart[] | null): string | null;
declare function matchFixture(fixtures: Fixture[], req: ChatCompletionRequest, matchCounts?: Map<Fixture, number>, requestTransform?: (req: ChatCompletionRequest) => ChatCompletionRequest): Fixture | null;
//# sourceMappingURL=router.d.ts.map

//#endregion
export { getTextContent, matchFixture };
//# sourceMappingURL=router.d.ts.map