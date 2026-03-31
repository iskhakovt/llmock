import { Fixture } from "./types.js";

//#region src/interruption.d.ts
interface InterruptionControl {
  signal: AbortSignal;
  tick(): void;
  cleanup(): void;
  reason(): string | undefined;
}
declare function createInterruptionSignal(fixture: Fixture): InterruptionControl | null;
//# sourceMappingURL=interruption.d.ts.map

//#endregion
export { InterruptionControl, createInterruptionSignal };
//# sourceMappingURL=interruption.d.ts.map