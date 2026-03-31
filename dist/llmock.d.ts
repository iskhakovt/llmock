import { ChaosConfig, EmbeddingFixtureOpts, Fixture, FixtureMatch, FixtureOpts, FixtureResponse, JournalEntry, MockServerOptions, RecordConfig } from "./types.js";
import { Journal } from "./journal.js";

//#region src/llmock.d.ts
declare class LLMock {
  private fixtures;
  private serverInstance;
  private options;
  constructor(options?: MockServerOptions);
  addFixture(fixture: Fixture): this;
  addFixtures(fixtures: Fixture[]): this;
  prependFixture(fixture: Fixture): this;
  getFixtures(): readonly Fixture[];
  loadFixtureFile(filePath: string): this;
  loadFixtureDir(dirPath: string): this;
  clearFixtures(): this;
  on(match: FixtureMatch, response: FixtureResponse, opts?: FixtureOpts): this;
  onMessage(pattern: string | RegExp, response: FixtureResponse, opts?: FixtureOpts): this;
  onEmbedding(pattern: string | RegExp, response: FixtureResponse, opts?: EmbeddingFixtureOpts): this;
  onJsonOutput(pattern: string | RegExp, jsonContent: object | string, opts?: FixtureOpts): this;
  onToolCall(name: string, response: FixtureResponse, opts?: FixtureOpts): this;
  onToolResult(id: string, response: FixtureResponse, opts?: FixtureOpts): this;
  /**
   * Queue a one-shot error that will be returned for the next matching
   * request, then automatically removed. Implemented as an internal fixture
   * with a `predicate` that always matches (so it fires first) and spliced
   * at the front of the fixture list.
   */
  nextRequestError(status: number, errorBody?: {
    message?: string;
    type?: string;
    code?: string;
  }): this;
  getRequests(): JournalEntry[];
  getLastRequest(): JournalEntry | null;
  clearRequests(): void;
  resetMatchCounts(): this;
  setChaos(config: ChaosConfig): this;
  clearChaos(): this;
  enableRecording(config: RecordConfig): this;
  disableRecording(): this;
  reset(): this;
  start(): Promise<string>;
  stop(): Promise<void>;
  get journal(): Journal;
  get url(): string;
  get baseUrl(): string;
  get port(): number;
  static create(options?: MockServerOptions): Promise<LLMock>;
}
//# sourceMappingURL=llmock.d.ts.map
//#endregion
export { LLMock };
//# sourceMappingURL=llmock.d.ts.map