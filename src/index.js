require("dotenv").config();

const express = require("express");
const { verifySignature, filterEvent, isDuplicate } = require("./webhook");
const github = require("./github");
const { analyzePR, classifyPR, scanSecurity } = require("./agent");
const { formatComment } = require("./formatter");
const store = require("./store");

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// We need raw body for signature verification, so use express.raw for webhook
// and express.json for everything else.
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  handleWebhook
);

app.use(express.json());

// ─── Health ──────────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "Probe" });
});

// ─── Dashboard ───────────────────────────────────────────────────────────────
app.get("/dashboard", (_req, res) => {
  const stats = store.getStats();
  const runs = store.getRuns();
  res.setHeader("Content-Type", "text/html");
  res.send(renderDashboard(stats, runs));
});

// ─── Stats API (JSON) ────────────────────────────────────────────────────────
app.get("/stats", (_req, res) => {
  res.json(store.getStats());
});

// ─── Webhook Handler ─────────────────────────────────────────────────────────
async function handleWebhook(req, res) {
  const rawBody = req.body; // Buffer because of express.raw
  const signature = req.headers["x-hub-signature-256"];
  const deliveryId = req.headers["x-github-delivery"];
  const event = req.headers["x-github-event"];

  // 1. Verify signature
  if (!verifySignature(rawBody, signature)) {
    console.log("[Probe] Signature verification failed");
    return res.status(401).json({ error: "Invalid signature" });
  }

  // 2. Parse body
  let body;
  try {
    body = JSON.parse(rawBody.toString());
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  // 3. Filter event
  const { shouldProcess, reason } = filterEvent(req.headers, body);
  if (!shouldProcess) {
    console.log(`[Probe] Skipped: ${reason}`);
    return res.status(200).json({ skipped: true, reason });
  }

  // 4. Idempotency
  if (isDuplicate(deliveryId)) {
    console.log(`[Probe] Duplicate delivery: ${deliveryId}`);
    return res.status(200).json({ skipped: true, reason: "duplicate delivery" });
  }

  // 5. ACK fast, process async
  res.status(202).json({ accepted: true });

  // Process in background
  const pr = body.pull_request;
  const repoFullName = body.repository.full_name;
  const [owner, repo] = repoFullName.split("/");
  const pullNumber = pr.number;
  const prAuthor = pr.user?.login;

  console.log(`[Probe] Processing PR #${pullNumber} on ${repoFullName} (${body.action})`);

  const startTime = Date.now();

  try {
    // 6. Fetch diff + changed files in parallel
    const [{ diff, truncated }, changedFiles] = await Promise.all([
      github.getPRDiff(owner, repo, pullNumber),
      github.getChangedFiles(owner, repo, pullNumber),
    ]);

    // Extract top-level modules from file paths
    const modules = extractModules(changedFiles);

    // 6b. Classify PR into QA categories (heuristic, runs before LLM call)
    const qaCategories = classifyPR({
      changedFiles,
      diff,
      prTitle: pr.title,
      prBody: pr.body,
    });
    console.log(`[Probe] QA categories: ${qaCategories.map((c) => c.category).join(", ")}`);

    // 6c. Run security pre-scan (regex-based, runs before LLM call)
    const securityFindings = scanSecurity(diff);
    if (securityFindings.length > 0) {
      console.log(`[Probe] Security pre-scan: ${securityFindings.length} signal(s) detected`);
    }

    // 7. Run LLM analysis + reviewer lookup in parallel
    const [agentResult, reviewers] = await Promise.allSettled([
      analyzePR({
        repoName: repoFullName,
        prTitle: pr.title,
        prBody: pr.body,
        changedFiles,
        diff,
        truncated,
        qaCategories,
        securityFindings,
      }),
      github.getSuggestedReviewers(owner, repo, changedFiles, prAuthor),
    ]);

    const latencyMs = Date.now() - startTime;

    // Resolve reviewers (always usable even if agent fails)
    const resolvedReviewers =
      agentResult.status === "fulfilled" || true
        ? reviewers.status === "fulfilled"
          ? reviewers.value
          : []
        : [];
    const actualReviewers =
      reviewers.status === "fulfilled" ? reviewers.value : [];

    let commentBody;
    let runRecord;

    if (
      agentResult.status === "fulfilled" &&
      agentResult.value.analysis !== null
    ) {
      // Success path
      const { analysis, tokens_used, cost_usd } = agentResult.value;
      commentBody = formatComment({ analysis, reviewers: actualReviewers, filesChanged: changedFiles.length, qaCategories });
      runRecord = {
        pr_number: pullNumber,
        repo: repoFullName,
        status: "success",
        risk_level: analysis.risk_score?.level || "unknown",
        files_changed: changedFiles.length,
        modules_affected: modules,
        tokens_used,
        cost_usd,
        latency_ms: latencyMs,
      };
    } else {
      // Fallback path — agent failed or returned invalid JSON
      const error =
        agentResult.status === "rejected"
          ? agentResult.reason?.message || "Agent error"
          : "Model returned invalid JSON";

      commentBody = formatComment({
        fallback: {
          filesChanged: changedFiles.length,
          modules,
          reviewers: actualReviewers,
          error,
        },
      });

      const agentCost =
        agentResult.status === "fulfilled" ? agentResult.value : {};
      runRecord = {
        pr_number: pullNumber,
        repo: repoFullName,
        status: "fallback",
        risk_level: "unknown",
        files_changed: changedFiles.length,
        modules_affected: modules,
        tokens_used: agentCost.tokens_used || 0,
        cost_usd: agentCost.cost_usd || 0,
        latency_ms: latencyMs,
      };
    }

    // 8. Post/update comment
    const commentResult = await github.upsertComment(
      owner,
      repo,
      pullNumber,
      commentBody
    );
    console.log(
      `[Probe] Comment ${commentResult.action} on PR #${pullNumber} (id: ${commentResult.commentId})`
    );

    // 9. Log run
    store.addRun(runRecord);
    console.log(
      `[Probe] Run logged: ${runRecord.status} | ${latencyMs}ms | $${runRecord.cost_usd}`
    );
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    console.error(`[Probe] Pipeline error on PR #${pullNumber}:`, err.message);
    store.addRun({
      pr_number: pullNumber,
      repo: repoFullName,
      status: "failure",
      risk_level: "unknown",
      files_changed: 0,
      modules_affected: [],
      tokens_used: 0,
      cost_usd: 0,
      latency_ms: latencyMs,
    });
  }
}

/**
 * Extract unique top-level directories from changed files.
 */
function extractModules(changedFiles) {
  const moduleSet = new Set();
  for (const file of changedFiles) {
    const parts = file.filename.split("/");
    if (parts.length > 1) {
      moduleSet.add(parts[0]);
    } else {
      moduleSet.add("(root)");
    }
  }
  return Array.from(moduleSet);
}

/**
 * Render the observability dashboard as HTML.
 */
function renderDashboard(stats, runs) {
  const rows = runs
    .map(
      (r) => `
      <tr>
        <td>${r.id}</td>
        <td>${r.repo}</td>
        <td>#${r.pr_number}</td>
        <td class="status-${r.status}">${r.status}</td>
        <td>${r.risk_level}</td>
        <td>${r.files_changed}</td>
        <td>${r.modules_affected.join(", ")}</td>
        <td>${r.tokens_used.toLocaleString()}</td>
        <td>$${r.cost_usd.toFixed(4)}</td>
        <td>${r.latency_ms.toLocaleString()}ms</td>
        <td>${new Date(r.timestamp).toLocaleString()}</td>
      </tr>`
    )
    .join("");

  const risk = stats.risk_distribution || {};
  const riskBar = stats.total > 0
    ? `<div class="risk-bar">
        <div class="risk-seg risk-low" style="width:${((risk.Low || 0) / stats.total) * 100}%"></div>
        <div class="risk-seg risk-med" style="width:${((risk.Medium || 0) / stats.total) * 100}%"></div>
        <div class="risk-seg risk-high" style="width:${((risk.High || 0) / stats.total) * 100}%"></div>
       </div>
       <div style="font-size:12px;color:#8b949e;margin-top:4px;">Low: ${risk.Low || 0} | Medium: ${risk.Medium || 0} | High: ${risk.High || 0}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="refresh" content="30" />
  <title>Probe — Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; padding: 24px; }
    h1 { color: #58a6ff; margin-bottom: 4px; }
    .subtitle { color: #8b949e; margin-bottom: 24px; }
    .section-title { color: #58a6ff; font-size: 16px; font-weight: 600; margin: 24px 0 12px 0; border-bottom: 1px solid #21262d; padding-bottom: 8px; }
    .stats { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px 18px; min-width: 130px; flex: 1; }
    .stat-card .label { color: #8b949e; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-card .value { color: #f0f6fc; font-size: 22px; font-weight: 600; margin-top: 4px; }
    .stat-card .sub { color: #8b949e; font-size: 11px; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; background: #161b22; border-radius: 8px; overflow: hidden; }
    th { background: #21262d; color: #8b949e; text-align: left; padding: 10px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 10px 12px; border-top: 1px solid #21262d; font-size: 13px; }
    tr:hover { background: #1c2128; }
    .status-success { color: #3fb950; font-weight: 600; }
    .status-failure { color: #f85149; font-weight: 600; }
    .status-fallback { color: #d29922; font-weight: 600; }
    .empty { text-align: center; color: #8b949e; padding: 40px; }
    .risk-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: #21262d; margin-top: 8px; }
    .risk-seg { height: 100%; }
    .risk-low { background: #3fb950; }
    .risk-med { background: #d29922; }
    .risk-high { background: #f85149; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>Probe Dashboard</h1>
  <p class="subtitle">PR Intelligence Agent — Observability &amp; Cost Awareness</p>

  <!-- ── Run Overview ── -->
  <div class="section-title">Run Overview</div>
  <div class="stats">
    <div class="stat-card"><div class="label">Total Runs</div><div class="value">${stats.total}</div><div class="sub">${stats.success_rate}% success rate</div></div>
    <div class="stat-card"><div class="label">Successful</div><div class="value" style="color:#3fb950">${stats.successful}</div></div>
    <div class="stat-card"><div class="label">Fallback</div><div class="value" style="color:#d29922">${stats.fallback}</div></div>
    <div class="stat-card"><div class="label">Failed</div><div class="value" style="color:#f85149">${stats.failed}</div></div>
    <div class="stat-card"><div class="label">Repos Analyzed</div><div class="value">${stats.repos_analyzed}</div></div>
    <div class="stat-card"><div class="label">Uptime</div><div class="value" style="font-size:16px">${stats.uptime_hours}h</div><div class="sub">Since ${new Date(stats.started_at).toLocaleString()}</div></div>
  </div>

  <div class="grid-2">
    <!-- ── Cost & Token Tracking ── -->
    <div>
      <div class="section-title">Cost &amp; Tokens</div>
      <div class="stats">
        <div class="stat-card"><div class="label">Total Cost</div><div class="value">$${stats.total_cost_usd.toFixed(4)}</div></div>
        <div class="stat-card"><div class="label">Avg Cost / PR</div><div class="value">$${stats.avg_cost_usd.toFixed(4)}</div></div>
        <div class="stat-card"><div class="label">Total Tokens</div><div class="value">${stats.total_tokens.toLocaleString()}</div></div>
        <div class="stat-card"><div class="label">Avg Tokens / PR</div><div class="value">${Math.round(stats.avg_tokens).toLocaleString()}</div></div>
      </div>

      <div class="section-title">Cost Projections</div>
      <div class="stats">
        <div class="stat-card"><div class="label">Throughput</div><div class="value" style="font-size:18px">${stats.runs_per_hour} runs/hr</div><div class="sub">${stats.projected_daily_runs} runs/day projected</div></div>
        <div class="stat-card"><div class="label">Daily Cost</div><div class="value">$${stats.projected_daily_cost.toFixed(2)}</div><div class="sub">at current rate</div></div>
        <div class="stat-card"><div class="label">Monthly Cost</div><div class="value">$${stats.projected_monthly_cost.toFixed(2)}</div><div class="sub">at current rate</div></div>
      </div>
    </div>

    <!-- ── Latency & Risk ── -->
    <div>
      <div class="section-title">Latency</div>
      <div class="stats">
        <div class="stat-card"><div class="label">Avg Latency</div><div class="value">${Math.round(stats.avg_latency_ms).toLocaleString()}ms</div></div>
        <div class="stat-card"><div class="label">P50</div><div class="value">${Math.round(stats.p50_latency_ms).toLocaleString()}ms</div></div>
        <div class="stat-card"><div class="label">P95</div><div class="value">${Math.round(stats.p95_latency_ms).toLocaleString()}ms</div></div>
        <div class="stat-card"><div class="label">P99</div><div class="value">${Math.round(stats.p99_latency_ms).toLocaleString()}ms</div></div>
      </div>

      <div class="section-title">Risk Distribution</div>
      ${riskBar}
    </div>
  </div>

  <!-- ── Run History ── -->
  <div class="section-title" style="margin-top:24px">Run History</div>
  ${
    runs.length > 0
      ? `<table>
    <thead>
      <tr><th>#</th><th>Repo</th><th>PR</th><th>Status</th><th>Risk</th><th>Files</th><th>Modules</th><th>Tokens</th><th>Cost</th><th>Latency</th><th>Time</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`
      : `<div class="empty">No runs yet. Open a PR on a connected repo to see Probe in action.</div>`
  }

  <div style="margin-top:24px;text-align:center;color:#8b949e;font-size:12px;">
    Probe — PR Intelligence Agent | Auto-refreshes every 30s | ${stats.latest_timestamp ? "Last run: " + new Date(stats.latest_timestamp).toLocaleString() : "Waiting for first run"}
  </div>
</body>
</html>`;
}

// ─── Start Server ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Probe] Server running on port ${PORT}`);
  console.log(`[Probe] Health:    http://localhost:${PORT}/health`);
  console.log(`[Probe] Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`[Probe] Webhook:   POST http://localhost:${PORT}/webhook`);
});
