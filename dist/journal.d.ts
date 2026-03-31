import { Fixture, JournalEntry } from "./types.js";

//#region src/journal.d.ts
declare class Journal {
  private entries;
  readonly fixtureMatchCounts: Map<Fixture, number>;
  add(entry: Omit<JournalEntry, "id" | "timestamp">): JournalEntry;
  getAll(opts?: {
    limit?: number;
  }): JournalEntry[];
  getLast(): JournalEntry | null;
  findByFixture(fixture: Fixture): JournalEntry[];
  getFixtureMatchCount(fixture: Fixture): number;
  incrementFixtureMatchCount(fixture: Fixture, allFixtures?: readonly Fixture[]): void;
  clearMatchCounts(): void;
  clear(): void;
  get size(): number;
}
//# sourceMappingURL=journal.d.ts.map

//#endregion
export { Journal };
//# sourceMappingURL=journal.d.ts.map