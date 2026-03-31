//#region src/metrics.d.ts
/**
 * Lightweight Prometheus metrics registry for LLMock.
 *
 * Zero external dependencies — implements counters, histograms, and gauges
 * with Prometheus text exposition format serialization.
 */
interface MetricsRegistry {
  incrementCounter(name: string, labels: Record<string, string>): void;
  observeHistogram(name: string, labels: Record<string, string>, value: number): void;
  setGauge(name: string, labels: Record<string, string>, value: number): void;
  serialize(): string;
  reset(): void;
}
declare function createMetricsRegistry(): MetricsRegistry;
/**
 * Normalize parametric API paths to route patterns for use as metric labels.
 * Replaces dynamic segments (model IDs, deployment names, etc.) with placeholders.
 */
declare function normalizePathLabel(pathname: string): string;
//# sourceMappingURL=metrics.d.ts.map
//#endregion
export { MetricsRegistry, createMetricsRegistry, normalizePathLabel };
//# sourceMappingURL=metrics.d.cts.map