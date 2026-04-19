const OpenAI = require("openai");

let _client;
function getClient() {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }
  return _client;
}

const MODEL = process.env.LLM_MODEL || "llama-3.3-70b-versatile";

// ─── QA Category Heuristics ─────────────────────────────────────────────────

const QA_RULES = [
  {
    category: "frontend_ui",
    label: "Frontend / UI",
    pathPatterns: [
      /\.html$/, /\.css$/, /\.scss$/, /\.less$/, /\.sass$/,
      /\.jsx?$/, /\.tsx?$/, /\.vue$/, /\.svelte$/,
      /components\//, /pages\//, /ui\//, /views\//, /styles\//, /layouts\//, /templates\//,
    ],
    diffPatterns: [/document\./, /window\./, /addEventListener/, /querySelector/, /innerHTML/, /className/],
  },
  {
    category: "api_backend",
    label: "API / Backend",
    pathPatterns: [
      /routes\//, /controllers\//, /api\//, /server\//, /handlers\//, /middleware\//, /services\//,
      /endpoints\//, /resolvers\//, /graphql\//,
      /\.py$/, /\.go$/, /\.rb$/, /\.php$/, /\.java$/, /\.kt$/, /\.rs$/, /\.cs$/, /\.swift$/,
    ],
    diffPatterns: [/app\.(get|post|put|delete|patch)\(/, /router\./, /@(Get|Post|Put|Delete|Patch)/, /def\s+\w+.*request/i, /func\s+\w+Handler/],
  },
  {
    category: "auth_security",
    label: "Auth / Security",
    pathPatterns: [/auth/, /login/, /signup/, /register/, /session/, /token/, /permissions?\//, /security\//, /roles\//, /guard\//],
    diffPatterns: [/password/i, /jwt/i, /bearer/i, /oauth/i, /secret/i, /encrypt/i, /hash/i, /csrf/i, /cors/i, /bcrypt/i, /argon/i, /sanitize/i, /xss/i],
  },
  {
    category: "database",
    label: "Database",
    pathPatterns: [
      /db\//, /schema/, /migration/, /\.sql$/, /models\//, /entities\//,
      /prisma\//, /sequelize\//, /knex\//, /typeorm\//, /mongoose\//, /drizzle\//,
      /repositories\//, /dao\//,
    ],
    diffPatterns: [/CREATE TABLE/i, /ALTER TABLE/i, /DROP TABLE/i, /INDEX/i, /\.query\(/i, /\.execute\(/i, /\.findOne\(/i, /\.findMany\(/i, /\.aggregate\(/i, /SELECT\s+/i, /INSERT\s+INTO/i, /UPDATE\s+.*SET/i, /DELETE\s+FROM/i],
  },
  {
    category: "payments",
    label: "Payments / Billing",
    pathPatterns: [/payment/, /billing/, /checkout/, /invoice/, /subscription/, /stripe/, /pricing/, /razorpay/, /paypal/],
    diffPatterns: [/charge/i, /refund/i, /amount/i, /currency/i, /transaction/i, /price/i, /discount/i, /coupon/i],
  },
  {
    category: "infra_config",
    label: "Infrastructure / Config",
    pathPatterns: [
      /Dockerfile/, /docker-compose/, /\.github\//, /\.env/, /\.yml$/, /\.yaml$/, /\.toml$/,
      /nginx/, /deploy/, /terraform\//, /k8s\//, /helm\//,
      /\.config\.(js|ts|mjs|cjs)$/, /webpack/, /vite\.config/, /next\.config/, /tsconfig/,
      /Makefile$/, /Procfile$/, /\.sh$/,
    ],
    diffPatterns: [],
  },
  {
    category: "testing",
    label: "Tests",
    pathPatterns: [
      /\.test\.(js|ts|jsx|tsx|py|go|rb|java|kt|rs)$/, /\.spec\.(js|ts|jsx|tsx|py|go|rb|java|kt|rs)$/,
      /__tests__\//, /test\//, /tests\//, /spec\//, /specs\//,
      /_test\.go$/, /_test\.py$/,
    ],
    diffPatterns: [/describe\(/, /it\(/, /test\(/, /expect\(/, /assert/, /def\s+test_/, /func\s+Test/],
  },
  {
    category: "bugfix",
    label: "Bug Fix",
    pathPatterns: [],
    diffPatterns: [/\bfix(ed|es|ing)?\b/i, /\bbug\b/i, /\bissue\b/i, /\bresolve[ds]?\b/i, /\bpatch\b/i, /\bhotfix\b/i],
  },
];

// ─── Security Scan Heuristics ────────────────────────────────────────────────

const SECURITY_PATTERNS = [
  {
    id: "hardcoded_secret",
    label: "Hardcoded Secret / API Key",
    severity: "critical",
    patterns: [
      /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\s*[:=]\s*["'][a-zA-Z0-9_\-/.+=]{8,}/i,
      /(?:AKIA|AIza|sk-|sk_live_|sk_test_|ghp_|gho_|ghs_|ghu_|glpat-|xox[boaprs]-)[a-zA-Z0-9_\-]{10,}/,
      /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
      /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}["']/i,
    ],
  },
  {
    id: "sql_injection",
    label: "Potential SQL Injection",
    severity: "critical",
    patterns: [
      /(?:query|execute|raw)\s*\(\s*[`"'].*\$\{/,
      /(?:query|execute|raw)\s*\(\s*["'].*["']\s*\+/,
      /\.query\s*\(\s*`[^`]*\$\{/,
    ],
  },
  {
    id: "xss",
    label: "Potential XSS",
    severity: "warning",
    patterns: [
      /innerHTML\s*=\s*(?!['"]<)/,
      /\.html\(\s*[^'"<]/,
      /dangerouslySetInnerHTML/,
      /document\.write\s*\(/,
      /\beval\s*\(/,
      /new\s+Function\s*\(/,
    ],
  },
  {
    id: "insecure_crypto",
    label: "Weak / Insecure Cryptography",
    severity: "warning",
    patterns: [
      /createHash\s*\(\s*["']md5["']\)/i,
      /createHash\s*\(\s*["']sha1["']\)/i,
      /Math\.random\s*\(\s*\)/,
    ],
  },
  {
    id: "insecure_http",
    label: "Insecure HTTP Usage",
    severity: "warning",
    patterns: [
      /http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/,
      /fetch\s*\(\s*["']http:\/\/(?!localhost)/,
    ],
  },
  {
    id: "cors_misconfiguration",
    label: "CORS Misconfiguration",
    severity: "warning",
    patterns: [
      /Access-Control-Allow-Origin['":\s]+\*/,
      /cors\(\s*\)/,
      /origin:\s*(?:true|\*|['"]?\*['"]?)/,
    ],
  },
  {
    id: "debug_exposure",
    label: "Debug / Sensitive Data Exposure",
    severity: "warning",
    patterns: [
      /console\.log\s*\(.*(?:password|secret|token|key|credential|auth)/i,
      /\.env\b.*(?:KEY|SECRET|TOKEN|PASSWORD)/,
      /process\.env\.\w+.*(?:console|log|print|res\.json)/i,
    ],
  },
  {
    id: "path_traversal",
    label: "Potential Path Traversal",
    severity: "critical",
    patterns: [
      /(?:readFile|readFileSync|createReadStream)\s*\([^)]*(?:req\.|params\.|query\.)/,
      /path\.join\s*\([^)]*(?:req\.|params\.|query\.)/,
    ],
  },
  {
    id: "nosql_injection",
    label: "Potential NoSQL Injection",
    severity: "warning",
    patterns: [
      /\.\$where\s*\(/,
      /\{\s*\$(?:gt|gte|lt|lte|ne|in|nin|regex|where)\s*:/,
      /find(?:One)?\s*\(\s*(?:req\.body|req\.query|req\.params)/,
    ],
  },
  {
    id: "command_injection",
    label: "Potential Command Injection",
    severity: "critical",
    patterns: [
      /child_process.*exec\s*\([^)]*(?:req\.|params\.|query\.|body\.|\$\{)/,
      /exec\s*\(\s*`[^`]*\$\{/,
      /exec\s*\(\s*["'][^"']*["']\s*\+\s*(?:req|input|user|param)/i,
    ],
  },
];

/**
 * Scan the diff for security issues using regex patterns.
 * Only scans "+" lines (new code being added).
 * Returns array of { id, label, severity, line } matches.
 */
function scanSecurity(diff) {
  const findings = [];
  const addedLines = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));

  for (const line of addedLines) {
    const cleanLine = line.substring(1); // remove the "+" prefix
    for (const rule of SECURITY_PATTERNS) {
      for (const pattern of rule.patterns) {
        if (pattern.test(cleanLine)) {
          findings.push({
            id: rule.id,
            label: rule.label,
            severity: rule.severity,
            line: cleanLine.trim().substring(0, 120),
          });
          break; // one match per rule per line is enough
        }
      }
    }
  }

  // Deduplicate — one finding per rule ID, keep first occurrence
  const seen = new Set();
  return findings.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
}

/**
 * Classify a PR into QA categories based on file paths, diff content, and PR metadata.
 * Returns array of { category, label } objects.
 */
function classifyPR({ changedFiles, diff, prTitle, prBody }) {
  const matched = new Map();
  const allPaths = changedFiles.map((f) => f.filename);
  const textSignals = `${prTitle || ""} ${prBody || ""} ${diff || ""}`;

  for (const rule of QA_RULES) {
    for (const filePath of allPaths) {
      if (rule.pathPatterns.some((re) => re.test(filePath))) {
        matched.set(rule.category, rule.label);
        break;
      }
    }

    if (!matched.has(rule.category) && rule.diffPatterns.length > 0) {
      if (rule.diffPatterns.some((re) => re.test(textSignals))) {
        matched.set(rule.category, rule.label);
      }
    }
  }

  if (matched.size === 0) {
    matched.set("general", "General");
  }

  return Array.from(matched.entries()).map(([category, label]) => ({ category, label }));
}

// ─── System Prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Probe, the most thorough code reviewer in existence. You catch every bug. You miss nothing. Your reviews are used by engineering teams to prevent production incidents.

SCOPE: You are reviewing ONLY the changes in this PR diff.
- Lines with "+" prefix = NEW code being added. These are your primary target.
- Lines with "-" prefix = OLD code being removed. This was the CORRECT behavior before.
- Lines with no prefix = unchanged context. Assume these are correct.

Your job: find every place where the new "+" code breaks what the old "-" code did correctly.

Return ONLY a valid JSON object. No markdown, no explanation, no text outside the JSON.

═══════════════════════════════════════════
TASK 1: CODE REVIEW — Exhaustive Bug Detection
═══════════════════════════════════════════

ANALYSIS METHOD — You must analyze EVERY changed hunk in the diff using this procedure:

STEP 1 — LINE-BY-LINE COMPARISON:
For each "-" line that was removed and each "+" line that replaced it:
  - What did the OLD line do? What value did it produce?
  - What does the NEW line do? What value does it produce?
  - Are these the same? If not, is the difference intentional and correct, or is it a bug?

STEP 2 — RUNTIME TRACE:
For each changed function, mentally execute it with concrete inputs:
  - Pick a NORMAL input. What does the old code return? What does the new code return? Same?
  - Pick an EDGE CASE input (null, undefined, 0, false, empty string, empty array, index 0, first/last element). What does old code return? What does new code return? Same?
  - Pick a FAILURE input (network error, missing field, invalid ID). What does old code do? What does new code do? Same?

STEP 3 — CROSS-FILE IMPACT:
For each changed function, check:
  - Who CALLS this function? (Look at imports in other files in the diff)
  - Does the CALLER still handle the return type/shape correctly?
  - If the response shape changed in the backend, does the frontend still parse it correctly?
  - If a function now inserts/modifies/deletes data differently, what do OTHER functions that read that same data see?

CRITICAL ANTI-PATTERNS TO CATCH:

A) THE FALSY ZERO TRAP:
  if (!index) or if (!value) where index/value can legitimately be 0.
  findIndex() returns 0 for the first match. !0 === true. This means the first element is treated as "not found".
  Similarly, if(!num) blocks valid zero inputs.
  ALWAYS flag any !variable check where the variable could be 0 and 0 is valid.

B) THE ORPHANED DATA TRAP:
  Old code: modifies an object in-place (obj.field = newValue)
  New code: creates a NEW object and inserts it (.unshift/.push) but does NOT remove the old one.
  Result: the old entry is still in the array = DUPLICATE. The same ID now appears twice.
  ALWAYS check: if a function used to update in-place but now creates+inserts, does it also delete the original?

C) THE MISSING AWAIT TRAP:
  Old code: const result = await asyncFunction()
  New code: const result = asyncFunction() (await removed)
  Result: result is now a Promise object, not the resolved value. Any if(result) check passes because Promise is truthy. result.field is undefined. The caller sends a Promise as a response body.
  ALWAYS flag when await is removed from an async function call.

D) THE HTTP STATUS TRAP:
  Old code uses response.ok (which covers 200-299) or specific checks like res.status(204)
  New code uses response.status != 200 (which rejects 201 Created, 204 No Content, etc.)
  Or: Old code returns res.status(204).send() (no body), new code returns res.json({...}) (different contract).
  ALWAYS check if HTTP status codes or response methods changed between old and new code.

E) THE IN-PLACE MUTATION TRAP:
  array.reverse(), array.sort(), array.splice() MUTATE the original array.
  If the array is a shared module-level variable (like a data store), every caller now sees the mutated version.
  Old code: return [...array] (safe copy). New code: return array.reverse() (mutates original).
  Each call to the function permanently changes the shared data.
  ALWAYS flag .reverse()/.sort()/.splice() on shared/module-level arrays.

F) THE LOGICAL OPERATOR SWAP TRAP:
  Old code: if (!a || !b) — triggers when EITHER is missing.
  New code: if (!a && !b) — triggers only when BOTH are missing.
  This means validation is effectively bypassed: a single missing field no longer triggers an error.
  ALWAYS check if || was changed to && or vice versa in validation/guard logic.

G) THE FILTER INVERSION TRAP:
  Old code: array.filter(item => item.id !== targetId) — removes the target (keeps everything else)
  New code: array.filter(item => item.id === targetId) — keeps ONLY the target (removes everything else)
  Result: after "deleting" an item, the UI shows ONLY that item and loses all others.
  ALWAYS check the equality operator in .filter() calls — !== vs ===.

H) THE COMPARISON PRECISION TRAP:
  Old code: array.find(x => x.id === id) — exact match
  New code: array.find(x => x.id.startsWith(id)) — prefix match
  Result: looking up ID "abc" also matches "abcdef". Reads, updates, and deletes become ambiguous.
  Also: indexOf(x) > 0 misses index 0. Correct: indexOf(x) !== -1 or >= 0.
  ALWAYS flag startsWith/endsWith/includes when replacing exact equality for ID lookups.

Output:
{
  "findings": [
    {
      "severity": "critical | warning | suggestion",
      "bug_type": "logical_error | incorrect_condition | async_await_issue | missing_error_handling | edge_case_failure | incorrect_data_mutation | api_inconsistency | id_handling_issue | state_mutation_bug | security | style | other",
      "file": "exact file path from diff",
      "detail": "WHAT is wrong and WHAT HAPPENS at runtime with a concrete example. Format: '[function/line] does [X] instead of [Y]. When called with [input], returns [wrong value] instead of [correct value]. This causes [downstream consequence].'",
      "suggestion": "How to fix it in plain English.",
      "code_fix": "The exact corrected line(s) of code, copy-pasteable."
    }
  ],
  "summary": "X critical and Y warning bugs found. [One sentence on combined impact]."
}

FINDING RULES:
- Report ALL bugs. No cap. If there are 12 bugs, report 12.
- Every detail field MUST include a concrete runtime example with input → output.
- code_fix MUST be actual code, not a description. Copy-pasteable.
- NEVER say "could cause issues" or "may break" or "consider". Say "WILL cause [X] because [Y]".
- NEVER report style/naming if real bugs exist. Bugs first, always.
- Check EVERY anti-pattern (A through H) against every changed line. If you miss one, it ships to production.

═══════════════════════════════════════════
TASK 2: PRODUCT IMPACT — For Non-Technical Stakeholders
═══════════════════════════════════════════

Translate the bugs and changes into what the END USER will experience. Zero code jargon.

Rules:
- For each critical bug found in Task 1, write ONE plain English sentence about what the user sees.
- Use language like: "users will see...", "clicking X will...", "saving will...", "the page will show..."
- Start with "This change..."

Output:
{
  "user_facing": true/false,
  "summary": "2-4 sentences. Each critical bug gets its own user-facing consequence.",
  "affected_areas": ["specific product areas like 'credential list', 'delete flow', 'edit form'"]
}

═══════════════════════════════════════════
TASK 3: RISK SCORE — For Tech Leads
═══════════════════════════════════════════

Output:
{
  "level": "Low | Medium | High",
  "reason": "One sentence citing the number of critical bugs and what systems they affect.",
  "flags": ["one flag per critical/warning bug, naming the specific broken behavior"]
}

═══════════════════════════════════════════
TASK 4: BLAST RADIUS — For Architects
═══════════════════════════════════════════

Output:
{
  "modules_affected": ["top-level directories or logical modules"],
  "summary": "One sentence. Name the specific shared state or API contracts that are broken across modules.",
  "cross_module": true/false
}

═══════════════════════════════════════════
TASK 5: CHANGELOG ENTRY — For Release Managers
═══════════════════════════════════════════

Output:
{
  "category": "Added | Fixed | Changed | Removed | Security | Performance",
  "entry": "One sentence describing what the PR intends to do (not the bugs)."
}

═══════════════════════════════════════════
TASK 6: QA TESTING — For QA Engineers
═══════════════════════════════════════════

Design tests that would CATCH every bug from Task 1.

manual_checks rules:
- One test case per critical/warning bug. Each MUST include: endpoint or UI action, exact input, expected output, and what wrong output indicates.
- Format: "Do [action] with [input]. Expected: [correct result]. Bug indicator: [wrong result] means [specific bug]."

regression_watchouts rules:
- Name the exact shared variable, array, or API contract that is broken and which other functions/endpoints read from it.

automation_candidates rules:
- Specify test type (unit/integration/e2e), function or endpoint to test, input, and assertion.

Output:
{
  "focus": "One sentence.",
  "manual_checks": ["one per critical/warning bug, with input/expected/bug-indicator"],
  "regression_watchouts": ["name exact shared state and who else reads it"],
  "automation_candidates": ["test type + function/endpoint + assertion"]
}

═══════════════════════════════════════════
TASK 7: SECURITY SCAN — For Security Engineers
═══════════════════════════════════════════

The user message will include PRE-SCAN RESULTS from an automated regex-based security scanner that already ran on the diff. Use these as starting points, but also do your own analysis.

For each pre-scan finding, verify if it is a true positive or false positive and explain why.
Then scan for additional security issues the regex scanner may have missed:
- Authentication/authorization bypasses
- Sensitive data in logs or responses
- Missing input sanitization
- Insecure deserialization
- Rate limiting gaps on sensitive endpoints
- Privilege escalation paths
- SSRF (server-side request forgery) via user-controlled URLs

Output:
{
  "findings": [
    {
      "severity": "critical | warning | info",
      "category": "hardcoded_secret | sql_injection | xss | insecure_crypto | insecure_http | cors_misconfiguration | debug_exposure | path_traversal | nosql_injection | command_injection | auth_bypass | input_sanitization | sensitive_data_leak | other",
      "file": "file path or 'general'",
      "detail": "What the vulnerability is and how it could be exploited.",
      "remediation": "Specific fix. Include code if applicable."
    }
  ],
  "overall_risk": "none | low | medium | high | critical",
  "summary": "One sentence overall security assessment."
}

Rules:
- If the pre-scan found hardcoded secrets, always flag as critical.
- If no security issues are found, return findings as empty array, overall_risk as "none", and summary as "No security issues detected in this PR."
- Do NOT invent vulnerabilities. Only flag what is visible in the diff.

═══════════════════════════════════════════
FINAL RULES
═══════════════════════════════════════════
- Never invent code not in the diff.
- No filler. No generic sentences. Every word must carry information.
- If you are unsure whether something is a bug, report it as a warning. It is better to over-report than to miss a real bug.
- Return JSON with keys: code_review, product_impact, risk_score, blast_radius, changelog_entry, qa_testing, security_scan.`;

// Groq is free — track tokens but cost is $0
const COST_PER_1K_INPUT = 0;
const COST_PER_1K_OUTPUT = 0;

/**
 * Analyze a PR diff using Groq LLM.
 * Returns { analysis, tokens_used, cost_usd } or throws on unrecoverable error.
 */
async function analyzePR({ repoName, prTitle, prBody, changedFiles, diff, truncated, qaCategories, securityFindings }) {
  const userMessage = buildUserMessage({
    repoName,
    prTitle,
    prBody,
    changedFiles,
    diff,
    truncated,
    qaCategories,
    securityFindings,
  });

  const startTime = Date.now();

  const response = await getClient().chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.1,
    max_tokens: 5000,
  });

  const latencyMs = Date.now() - startTime;
  const choice = response.choices?.[0];
  const rawContent = choice?.message?.content || "";

  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;
  const totalTokens = inputTokens + outputTokens;
  const costUsd =
    (inputTokens / 1000) * COST_PER_1K_INPUT +
    (outputTokens / 1000) * COST_PER_1K_OUTPUT;

  const analysis = parseModelJSON(rawContent);

  return {
    analysis,
    tokens_used: totalTokens,
    cost_usd: Math.round(costUsd * 1000000) / 1000000,
    latency_ms: latencyMs,
  };
}

/**
 * Format security pre-scan findings for inclusion in the user message.
 */
function formatSecurityFindings(findings) {
  if (!findings || findings.length === 0) {
    return "Automated regex scan found no security signals in the diff. Perform your own analysis.";
  }

  const lines = findings.map(
    (f) => `  [${f.severity.toUpperCase()}] ${f.label}: "${f.line}"`
  );
  return `Automated regex scan detected ${findings.length} potential issue(s) in added lines:\n${lines.join("\n")}\n\nVerify each finding (true positive or false positive) and scan for additional issues the regex missed.`;
}

/**
 * Build the user message with rich PR context.
 */
function buildUserMessage({ repoName, prTitle, prBody, changedFiles, diff, truncated, qaCategories, securityFindings }) {
  const fileSummary = changedFiles
    .map((f) => {
      const status =
        f.status === "added"
          ? "[NEW]"
          : f.status === "removed"
            ? "[DELETED]"
            : f.status === "renamed"
              ? "[RENAMED]"
              : "[MODIFIED]";
      return `  ${status} ${f.filename} (+${f.additions} -${f.deletions})`;
    })
    .join("\n");

  const totalAdditions = changedFiles.reduce((sum, f) => sum + (f.additions || 0), 0);
  const totalDeletions = changedFiles.reduce((sum, f) => sum + (f.deletions || 0), 0);

  const truncNote = truncated
    ? "\n⚠️ DIFF TRUNCATED: The diff below was cut due to size. Analyze what is available and note this limitation.\n"
    : "";

  const qaCategoryList = qaCategories && qaCategories.length > 0
    ? qaCategories.map((c) => `  - ${c.category} (${c.label})`).join("\n")
    : "  - general (General)";

  return `=== PULL REQUEST CONTEXT ===
Repository: ${repoName}
PR Title: ${prTitle}
PR Description: ${prBody || "(no description provided)"}

=== FILE CHANGE SUMMARY ===
Total files changed: ${changedFiles.length}
Total additions: +${totalAdditions}
Total deletions: -${totalDeletions}

${fileSummary}

=== DETECTED QA CATEGORIES ===
${qaCategoryList}

=== SECURITY PRE-SCAN RESULTS ===
${formatSecurityFindings(securityFindings)}

=== ANALYSIS INSTRUCTIONS ===
The "-" lines below are the OLD CORRECT code. The "+" lines are the NEW code replacing it.
Your job: find every place where a "+" line breaks what its corresponding "-" line did correctly.

Check EVERY anti-pattern (A through H from your instructions) against EVERY changed line.
For each function that changed, trace it with: a normal input, a zero/empty input, and a failure input.
For each file that changed, check if other files in this diff import or depend on the changed function.
${truncNote}
=== DIFF ===
${diff}`;
}

/**
 * Safely parse model JSON output.
 */
function parseModelJSON(raw) {
  let cleaned = raw.trim();

  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (
      parsed.code_review &&
      parsed.product_impact &&
      parsed.risk_score &&
      parsed.blast_radius &&
      parsed.changelog_entry
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = { analyzePR, classifyPR, scanSecurity };
