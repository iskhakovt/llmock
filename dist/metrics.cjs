
//#region src/metrics.ts
const HISTOGRAM_BUCKETS = [
	.005,
	.01,
	.025,
	.05,
	.1,
	.25,
	.5,
	1,
	2.5,
	5,
	10
];
/** Build a stable label key string for map lookups: `label1="v1",label2="v2"` */
function labelKey(labels) {
	const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
	if (entries.length === 0) return "";
	return entries.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`).join(",");
}
/** Escape a label value per Prometheus text exposition format. */
function escapeLabelValue(v) {
	return v.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n");
}
/** Format labels for Prometheus output: `{label1="v1",label2="v2"}` */
function formatLabels(labels) {
	return `{${labelKey(labels)}}`;
}
function createMetricsRegistry() {
	/** Ordered map: metric name → data. Insertion order preserved for stable output. */
	const metrics = /* @__PURE__ */ new Map();
	function getOrCreateCounter(name) {
		let data = metrics.get(name);
		if (!data) {
			data = {
				type: "counter",
				series: /* @__PURE__ */ new Map()
			};
			metrics.set(name, data);
		}
		if (data.type !== "counter") throw new Error(`Metric ${name} is not a counter`);
		return data;
	}
	function getOrCreateHistogram(name) {
		let data = metrics.get(name);
		if (!data) {
			data = {
				type: "histogram",
				series: /* @__PURE__ */ new Map()
			};
			metrics.set(name, data);
		}
		if (data.type !== "histogram") throw new Error(`Metric ${name} is not a histogram`);
		return data;
	}
	function getOrCreateGauge(name) {
		let data = metrics.get(name);
		if (!data) {
			data = {
				type: "gauge",
				series: /* @__PURE__ */ new Map()
			};
			metrics.set(name, data);
		}
		if (data.type !== "gauge") throw new Error(`Metric ${name} is not a gauge`);
		return data;
	}
	return {
		incrementCounter(name, labels) {
			const counter = getOrCreateCounter(name);
			const key = labelKey(labels);
			const existing = counter.series.get(key);
			if (existing) existing.value += 1;
			else counter.series.set(key, {
				labels,
				value: 1
			});
		},
		observeHistogram(name, labels, value) {
			const histogram = getOrCreateHistogram(name);
			const key = labelKey(labels);
			let existing = histogram.series.get(key);
			if (!existing) {
				existing = {
					labels,
					bucketCounts: new Array(HISTOGRAM_BUCKETS.length).fill(0),
					sum: 0,
					count: 0
				};
				histogram.series.set(key, existing);
			}
			for (let i = 0; i < HISTOGRAM_BUCKETS.length; i++) if (value <= HISTOGRAM_BUCKETS[i]) existing.bucketCounts[i] += 1;
			existing.sum += value;
			existing.count += 1;
		},
		setGauge(name, labels, value) {
			const gauge = getOrCreateGauge(name);
			const key = labelKey(labels);
			const existing = gauge.series.get(key);
			if (existing) existing.value = value;
			else gauge.series.set(key, {
				labels,
				value
			});
		},
		serialize() {
			const lines = [];
			for (const [name, data] of metrics) switch (data.type) {
				case "counter":
					lines.push(`# TYPE ${name} counter`);
					for (const series of data.series.values()) lines.push(`${name}${formatLabels(series.labels)} ${series.value}`);
					break;
				case "histogram":
					lines.push(`# TYPE ${name} histogram`);
					for (const series of data.series.values()) {
						const lblStr = labelKey(series.labels);
						const lblPrefix = lblStr ? `${lblStr},` : "";
						for (let i = 0; i < HISTOGRAM_BUCKETS.length; i++) lines.push(`${name}_bucket{${lblPrefix}le="${HISTOGRAM_BUCKETS[i]}"} ${series.bucketCounts[i]}`);
						lines.push(`${name}_bucket{${lblPrefix}le="+Inf"} ${series.count}`);
						lines.push(`${name}_sum${formatLabels(series.labels)} ${series.sum}`);
						lines.push(`${name}_count${formatLabels(series.labels)} ${series.count}`);
					}
					break;
				case "gauge":
					lines.push(`# TYPE ${name} gauge`);
					for (const series of data.series.values()) lines.push(`${name}${formatLabels(series.labels)} ${series.value}`);
					break;
			}
			return lines.length > 0 ? lines.join("\n") + "\n" : "";
		},
		reset() {
			metrics.clear();
		}
	};
}
const BEDROCK_RE = /^\/model\/([^/]+)\/(invoke|invoke-with-response-stream|converse|converse-stream)$/;
const GEMINI_RE = /^\/v1beta\/models\/([^:]+):(generateContent|streamGenerateContent)$/;
const AZURE_RE = /^\/openai\/deployments\/([^/]+)\/(chat\/completions|embeddings)$/;
const VERTEX_RE = /^\/v1\/projects\/([^/]+)\/locations\/([^/]+)\/publishers\/google\/models\/([^:]+):(.+)$/;
/**
* Normalize parametric API paths to route patterns for use as metric labels.
* Replaces dynamic segments (model IDs, deployment names, etc.) with placeholders.
*/
function normalizePathLabel(pathname) {
	const bedrockMatch = pathname.match(BEDROCK_RE);
	if (bedrockMatch) return `/model/{modelId}/${bedrockMatch[2]}`;
	const geminiMatch = pathname.match(GEMINI_RE);
	if (geminiMatch) return `/v1beta/models/{model}:${geminiMatch[2]}`;
	const azureMatch = pathname.match(AZURE_RE);
	if (azureMatch) return `/openai/deployments/{id}/${azureMatch[2]}`;
	const vertexMatch = pathname.match(VERTEX_RE);
	if (vertexMatch) return `/v1/projects/{p}/locations/{l}/publishers/google/models/{m}:${vertexMatch[4]}`;
	return pathname;
}

//#endregion
exports.createMetricsRegistry = createMetricsRegistry;
exports.normalizePathLabel = normalizePathLabel;
//# sourceMappingURL=metrics.cjs.map