import { Logger } from "./logger.cjs";
import { Fixture } from "./types.cjs";

//#region src/fixture-loader.d.ts
declare function loadFixtureFile(filePath: string, logger?: Logger): Fixture[];
declare function loadFixturesFromDir(dirPath: string, logger?: Logger): Fixture[];
interface ValidationResult {
  severity: "error" | "warning";
  fixtureIndex: number;
  message: string;
}
declare function validateFixtures(fixtures: Fixture[]): ValidationResult[];
//# sourceMappingURL=fixture-loader.d.ts.map

//#endregion
export { ValidationResult, loadFixtureFile, loadFixturesFromDir, validateFixtures };
//# sourceMappingURL=fixture-loader.d.cts.map