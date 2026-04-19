/**
 * Format the full 7-section Probe comment from analysis + reviewers.
 */
function formatComment({ analysis, reviewers, filesChanged, qaCategories, fallback }) {
  if (fallback) {
    return formatFallbackComment(fallback);
  }

  const { code_review, product_impact, risk_score, blast_radius, changelog_entry, qa_testing, security_scan } =
    analysis;

  // ── Section 1: Code Review ──
  const severityIcon = { critical: "🔴", warning: "🟡", suggestion: "💡" };
  const severityLabel = { critical: "Critical", warning: "Warning", suggestion: "Suggestion" };

  const bugTypeLabel = {
    logical_error: "Logical Error",
    incorrect_condition: "Incorrect Condition",
    async_await_issue: "Async/Await Issue",
    missing_error_handling: "Missing Error Handling",
    edge_case_failure: "Edge Case Failure",
    incorrect_data_mutation: "Data Mutation",
    api_inconsistency: "API Inconsistency",
    id_handling_issue: "ID Handling",
    state_mutation_bug: "State Mutation",
    security: "Security",
    style: "Style",
    other: "Other",
  };

  const findings =
    code_review.findings && code_review.findings.length > 0
      ? code_review.findings
          .map((f) => {
            const icon = severityIcon[f.severity] || "💡";
            const label = severityLabel[f.severity] || "Note";
            const file = f.file ? ` in \`${f.file}\`` : "";
            const bugTag = f.bug_type && bugTypeLabel[f.bug_type]
              ? ` \`${bugTypeLabel[f.bug_type]}\``
              : "";
            const fix = f.suggestion ? `\n  - **Fix:** ${f.suggestion}` : "";
            const codeFix = f.code_fix
              ? `\n  - **Suggested code:**\n    \`\`\`js\n    ${f.code_fix.split("\n").join("\n    ")}\n    \`\`\``
              : "";
            return `- ${icon} **${label}**${bugTag}${file}: ${f.detail}${fix}${codeFix}`;
          })
          .join("\n\n")
      : "- No specific findings.";

  const codeSummary = code_review.summary || "";

  // ── Section 2: Product Impact ──
  const userFacingBadge = product_impact.user_facing
    ? "👤 **User-facing change**"
    : "⚙️ **Internal / infrastructure change**";

  const affectedAreas =
    product_impact.affected_areas && product_impact.affected_areas.length > 0
      ? product_impact.affected_areas.map((a) => `\`${a}\``).join(", ")
      : "_N/A_";

  // ── Section 3: Risk Score ──
  const riskEmoji =
    risk_score.level === "High"
      ? "🔴"
      : risk_score.level === "Medium"
        ? "🟡"
        : "🟢";

  const riskFlags =
    risk_score.flags && risk_score.flags.length > 0
      ? risk_score.flags.map((f) => `\`${f}\``).join("  ")
      : "";

  // ── Section 4: Blast Radius ──
  const actualFilesChanged = filesChanged || blast_radius.files_changed || 0;

  const modules =
    blast_radius.modules_affected && blast_radius.modules_affected.length > 0
      ? blast_radius.modules_affected.map((m) => `\`${m}\``).join(", ")
      : "_N/A_";

  const crossModuleNote = blast_radius.cross_module
    ? "⚠️ Cross-module change"
    : "Single-module change";

  // ── Section 5: Suggested Reviewers ──
  const reviewerList =
    reviewers.length > 0
      ? reviewers.map((r) => `@${r}`).join(", ")
      : "_No recent committers found for changed files._";

  // ── Section 6: Changelog Entry ──
  const changeCategory = changelog_entry.category || "Changed";
  const changeEntry = changelog_entry.entry || changelog_entry;

  // ── Section 7: QA Testing ──
  const qaSection = formatQASection(qa_testing, qaCategories);

  // ── Section 8: Security Scan ──
  const securitySection = formatSecuritySection(security_scan);

  return `# 🔍 Probe — PR Intelligence Report

---

## 1. Code Review
${findings}

> ${codeSummary}

---

## 2. Product Impact
${userFacingBadge}

${product_impact.summary}

**Affected areas:** ${affectedAreas}

---

## 3. Risk Score
${riskEmoji} **${risk_score.level}** — ${risk_score.reason}

${riskFlags ? `**Risk signals:** ${riskFlags}` : ""}

---

## 4. Blast Radius
| Metric | Value |
|--------|-------|
| **Files changed** | ${actualFilesChanged} |
| **Modules affected** | ${modules} |
| **Scope** | ${crossModuleNote} |

${blast_radius.summary}

---

## 5. Suggested Reviewers
${reviewerList}

---

## 6. Changelog Entry
**[${changeCategory}]** ${changeEntry}

---

${qaSection}

---

${securitySection}

---

<sub>Powered by <strong>Probe</strong> — PR Intelligence for your entire team.</sub>`;
}

/**
 * Format the QA Testing section (Section 7).
 */
function formatQASection(qaTesting, qaCategories) {
  // If the model didn't return qa_testing, render a minimal fallback
  if (!qaTesting) {
    return `## 7. QA Testing
_QA analysis was not generated for this PR._`;
  }

  const categoryTags =
    qaCategories && qaCategories.length > 0
      ? qaCategories.map((c) => `\`${c.label}\``).join("  ")
      : "`General`";

  const focus = qaTesting.focus || "No specific focus identified.";

  const manualChecks =
    qaTesting.manual_checks && qaTesting.manual_checks.length > 0
      ? qaTesting.manual_checks.map((c, i) => `${i + 1}. ${c}`).join("\n")
      : "_None identified._";

  const regressionWatchouts =
    qaTesting.regression_watchouts && qaTesting.regression_watchouts.length > 0
      ? qaTesting.regression_watchouts.map((r) => `- ⚠️ ${r}`).join("\n")
      : "_None identified._";

  const automationCandidates =
    qaTesting.automation_candidates && qaTesting.automation_candidates.length > 0
      ? qaTesting.automation_candidates.map((a) => `- 🤖 ${a}`).join("\n")
      : "_None identified._";

  return `## 7. QA Testing
**PR Type:** ${categoryTags}

**Focus:** ${focus}

### Manual Test Cases
${manualChecks}

### Regression Watchouts
${regressionWatchouts}

### Automation Candidates
${automationCandidates}`;
}

/**
 * Format the Security Scan section (Section 8).
 */
function formatSecuritySection(securityScan) {
  if (!securityScan) {
    return `## 8. Security Scan
🟢 _No security analysis was generated for this PR._`;
  }

  const riskIcon = {
    none: "🟢",
    low: "🟢",
    medium: "🟡",
    high: "🔴",
    critical: "🔴",
  };

  const severityIcon = {
    critical: "🔴",
    warning: "🟡",
    info: "ℹ️",
  };

  const overallIcon = riskIcon[securityScan.overall_risk] || "🟢";
  const summary = securityScan.summary || "No security issues detected.";

  const findings =
    securityScan.findings && securityScan.findings.length > 0
      ? securityScan.findings
          .map((f) => {
            const icon = severityIcon[f.severity] || "ℹ️";
            const file = f.file && f.file !== "general" ? ` in \`${f.file}\`` : "";
            const cat = f.category ? ` \`${f.category}\`` : "";
            const remediation = f.remediation ? `\n  - **Remediation:** ${f.remediation}` : "";
            return `- ${icon} **${(f.severity || "info").charAt(0).toUpperCase() + (f.severity || "info").slice(1)}**${cat}${file}: ${f.detail}${remediation}`;
          })
          .join("\n\n")
      : "No security issues found.";

  return `## 8. Security Scan
**Overall security risk:** ${overallIcon} **${(securityScan.overall_risk || "none").charAt(0).toUpperCase() + (securityScan.overall_risk || "none").slice(1)}**

> ${summary}

${securityScan.findings && securityScan.findings.length > 0 ? `### Findings\n${findings}` : "🟢 No vulnerabilities detected in the changed code."}`;
}

/**
 * Fallback comment when LLM analysis fails.
 */
function formatFallbackComment({ filesChanged, modules, reviewers, error }) {
  const reviewerList =
    reviewers.length > 0
      ? reviewers.map((r) => `@${r}`).join(", ")
      : "_No recent committers found for changed files._";

  const moduleList =
    modules.length > 0
      ? modules.map((m) => `\`${m}\``).join(", ")
      : "_N/A_";

  return `# 🔍 Probe — PR Intelligence Report

---

⚠️ **Analysis Incomplete** — The AI model returned an invalid response. Partial information is shown below.

**Error:** ${error}

---

## 4. Blast Radius
- **Files changed:** ${filesChanged}
- **Modules affected:** ${moduleList}

---

## 5. Suggested Reviewers
${reviewerList}

---

<sub>Powered by <strong>Probe</strong> — PR Intelligence for your entire team.</sub>`;
}

module.exports = { formatComment };
