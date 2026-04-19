// In-memory run store and idempotency tracking

const runs = [];
const processedDeliveries = new Set();
const startedAt = new Date().toISOString();

function hasDelivery(deliveryId) {
  return processedDeliveries.has(deliveryId);
}

function markDelivery(deliveryId) {
  processedDeliveries.add(deliveryId);
}

function addRun(run) {
  runs.unshift({
    id: runs.length + 1,
    pr_number: run.pr_number,
    repo: run.repo,
    status: run.status, // "success" | "failure" | "fallback"
    risk_level: run.risk_level || "unknown",
    files_changed: run.files_changed || 0,
    modules_affected: run.modules_affected || [],
    tokens_used: run.tokens_used || 0,
    cost_usd: run.cost_usd || 0,
    latency_ms: run.latency_ms || 0,
    timestamp: new Date().toISOString(),
  });
}

function getRuns() {
  return runs;
}

function getStats() {
  const total = runs.length;
  const successful = runs.filter((r) => r.status === "success").length;
  const fallback = runs.filter((r) => r.status === "fallback").length;
  const failed = runs.filter((r) => r.status === "failure").length;

  const costs = runs.map((r) => r.cost_usd);
  const latencies = runs.map((r) => r.latency_ms);
  const tokens = runs.map((r) => r.tokens_used);

  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const avg = (arr) => (arr.length > 0 ? sum(arr) / arr.length : 0);
  const percentile = (arr, p) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  };

  const totalCost = sum(costs);
  const totalTokens = sum(tokens);
  const avgCost = avg(costs);
  const avgLatency = avg(latencies);

  // Unique repos analyzed
  const repos = new Set(runs.map((r) => r.repo));

  // Risk distribution
  const riskCounts = { Low: 0, Medium: 0, High: 0, unknown: 0 };
  for (const r of runs) {
    riskCounts[r.risk_level] = (riskCounts[r.risk_level] || 0) + 1;
  }

  // Cost projections
  const uptimeMs = Date.now() - new Date(startedAt).getTime();
  const uptimeHours = uptimeMs / (1000 * 60 * 60);
  const runsPerHour = uptimeHours > 0 ? total / uptimeHours : 0;

  return {
    total,
    successful,
    fallback,
    failed,
    success_rate: total > 0 ? Math.round((successful / total) * 100) : 0,
    total_cost_usd: totalCost,
    avg_cost_usd: avgCost,
    total_tokens: totalTokens,
    avg_tokens: avg(tokens),
    avg_latency_ms: avgLatency,
    p50_latency_ms: percentile(latencies, 50),
    p95_latency_ms: percentile(latencies, 95),
    p99_latency_ms: percentile(latencies, 99),
    min_latency_ms: latencies.length > 0 ? Math.min(...latencies) : 0,
    max_latency_ms: latencies.length > 0 ? Math.max(...latencies) : 0,
    repos_analyzed: repos.size,
    risk_distribution: riskCounts,
    runs_per_hour: Math.round(runsPerHour * 100) / 100,
    projected_daily_cost: avgCost * runsPerHour * 24,
    projected_monthly_cost: avgCost * runsPerHour * 24 * 30,
    projected_daily_runs: Math.round(runsPerHour * 24),
    uptime_hours: Math.round(uptimeHours * 100) / 100,
    started_at: startedAt,
    latest_timestamp: runs.length > 0 ? runs[0].timestamp : null,
  };
}

module.exports = {
  hasDelivery,
  markDelivery,
  addRun,
  getRuns,
  getStats,
};
