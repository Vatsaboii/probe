# PROBE — PR Intelligence Agent

## Complete Project Plan

## Reviewer Verdict

This is a strong MVP idea and a very good hackathon/demo product. The positioning is clear, the value is easy to understand, and the implementation scope is realistic.

It is **not fully perfect yet**, but it is **very viable** if we make a few targeted improvements:

1. Add **comment upsert behavior** so Probe updates its own previous PR comment instead of posting duplicates on every sync.
2. Add **diff size control** so very large PRs do not break latency, token cost, or JSON reliability.
3. Add **basic idempotency + error handling** so webhook retries do not trigger duplicate runs/comments.
4. Prefer **GitHub App credentials for future production**, but keep `GITHUB_TOKEN` for MVP simplicity.
5. Add a **fallback response path** when the model returns invalid JSON or times out.
6. Tighten reviewer suggestions so they are based on **recent committers for changed files with author exclusion and deduping**.
7. Track **status per run** in the dashboard, not only successful runs, so observability is more credible.

These changes are reflected directly in the plan below.

---

## PROBLEM STATEMENT

Every pull request is more than just a code change — it is a decision point that affects the entire engineering team. Yet today, the tools built around pull requests are deeply developer-centric. When a developer opens a PR, a tool like CodeRabbit might review the code quality and leave comments about bugs or style issues. But the product manager sitting next to that developer has no idea what the PR means for the end user. The tech lead cannot quickly assess whether the change is risky without reading every line of the diff. Nobody knows which teammates are best positioned to review the specific files that were changed. And when release day comes, someone has to sit down and manually write the changelog from memory, because nobody documented what each PR actually did.

The result is a workflow that is broken in four specific ways: reviews are slow because the wrong people are reviewing, risks are missed because nobody explicitly assessed them, cross-team communication is poor because non-technical stakeholders cannot read code, and release documentation is either incomplete or written incorrectly after the fact.

CodeRabbit exists, but it solves only one slice of this problem — code quality feedback for the developer who wrote the PR. The PM, the tech lead, the architect, and the release manager are all still left in the dark after every single PR. This is the gap that Probe fills.

The core problem in one sentence: **a pull request affects code, product, and people — but every tool today only looks at code.**

---

## SOLUTION: PROBE

Probe is an AI-powered GitHub PR Intelligence Agent. It runs as a persistent server that listens for GitHub webhook events. The moment a pull request is opened or updated on a connected repository, Probe automatically fetches the PR diff, sends it to GPT with a structured prompt, and posts a comprehensive six-section team briefing as a GitHub comment — ideally within 30 seconds for normal-sized PRs, with zero human intervention.

The one-line pitch: **CodeRabbit reviews your code. Probe briefs your entire team.**

### Updated viability note

For MVP/demo use, Probe should analyze:

- `pull_request.opened`
- `pull_request.synchronize`
- optionally `pull_request.reopened`

Probe should ignore closed PRs and non-code events, and it should **update its own prior comment** instead of creating a new one each time.

---

## THE SIX OUTPUTS

Every Probe comment contains exactly six sections, each serving a different member of the team:

### Section 1 — Code Review

Specific, actionable feedback on the code changes. Identifies bugs, unhandled edge cases, and improvement suggestions. References actual variable names, functions, and line numbers from the diff where possible. Written for the developer who submitted the PR.

### Section 2 — Product Impact

A plain-English explanation of what this change means for the end user and the product. Written for a non-technical product manager. Starts with **"This change..."** and focuses on user-facing behavior, not implementation details.

### Section 3 — Risk Score

A Low, Medium, or High risk classification with a single-sentence justification. Risk is assessed based on what systems are touched — payment logic, authentication, database mutations, public API changes, infrastructure-sensitive code, and the overall size and complexity of the change. Written for the tech lead.

### Section 4 — Blast Radius

The number of files changed, the list of top-level modules affected, and a one-sentence summary of the overall scope of the change. Written for the architect or engineering manager who needs a quick sense of how wide-reaching this PR is.

### Section 5 — Suggested Reviewers

A list of GitHub usernames recommended to review the PR, based on who has most recently committed to the specific files being changed. Fetched via the GitHub API by looking at the commit history of each changed file, excluding the PR author where possible and deduplicating repeated names. Written for the team lead who needs to assign reviewers.

### Section 6 — Changelog Entry

A single, clean, user-facing sentence suitable for a public changelog. Written in past tense. Auto-generated from the diff so release managers have a ready-to-paste entry without needing to summarize the PR manually.

---

## TRACK AND SCORING

Track: **MaaS — Model as a Service**

Probe is a clear MaaS entry because it runs an AI agent automatically on a trigger, produces structured and observable output, and runs repeatedly at scale on every PR without human involvement. The MaaS rubric rewards five parameters: live product quality, agent output quality, observability, cost and latency awareness, and OpenAI/OpenCode usage. Probe directly addresses every one of these.

### Bonus strategy

Probe is also eligible for cross-track bonus points on the Virality track because every comment it posts can include a **"Powered by Probe"** footer with a link, meaning the product distributes itself through its own output to every developer who sees the comment on any PR.

---

## ARCHITECTURE

The architecture is intentionally simple:

1. A pull request is opened or updated on a connected GitHub repository.
2. GitHub fires a `POST` request to Probe's webhook endpoint with the PR payload.
3. Probe verifies the webhook signature using a shared secret.
4. Probe checks whether the event should be processed and whether this delivery was already handled.
5. Probe fetches the list of changed files and the PR diff using the GitHub API.
6. Probe trims or summarizes the diff if it is too large for the model budget.
7. Probe sends the diff plus metadata to GPT with a structured prompt and receives a JSON response containing the analysis outputs.
8. In parallel, Probe calls the GitHub commits API to retrieve the most recent committers on each changed file and deduplicates them to produce the Suggested Reviewers list.
9. Probe formats all six outputs into a clean markdown comment.
10. Probe creates or updates a single Probe comment on the PR using the GitHub Issues API.
11. Probe logs the run details — PR number, repo, status, risk level, tokens used, estimated cost in USD, files changed, modules affected, and latency in milliseconds — to an in-memory store.
12. The run appears in the live observability dashboard at `GET /dashboard`.

### Important operational upgrades

- **Idempotency:** store processed delivery IDs in memory for the demo so GitHub retries do not double-post.
- **Comment lifecycle:** update Probe's prior bot comment if it already exists.
- **Fallback handling:** if model JSON parsing fails, post a reduced fallback comment that still includes blast radius, reviewer suggestions, and an explicit error note.
- **Large diff policy:** analyze only the changed files plus a bounded diff size, and note when the analysis used a truncated diff.

### MVP architecture decisions

- No database
- No user auth
- No frontend app beyond the dashboard
- Configuration via environment variables only

---

## TECH STACK

- Runtime: Node.js 20+
- Framework: Express.js
- GitHub SDK: `@octokit/rest`
- AI SDK: `openai` official OpenAI Node SDK
- Environment management: `dotenv`
- Deployment: Railway
- No database
- No auth library
- No frontend framework

### Reviewer suggestion

For MVP, `GITHUB_TOKEN` is acceptable. For future production viability, a **GitHub App** is the better long-term path because it offers better permissions, repo installation flow, and cleaner security posture.

---

## Proposed File Structure

```text
probe/
├── src/
│   ├── index.js          — Entry point, Express server, health route, dashboard route
│   ├── webhook.js        — Webhook signature verification, event filtering, idempotency guard
│   ├── github.js         — Fetch PR diff/files, fetch committers, create/update comment
│   ├── agent.js          — GPT call, structured JSON output, token/cost calculation, fallback handling
│   ├── formatter.js      — Format all 6 outputs into markdown comment
│   └── store.js          — In-memory run store and processed delivery IDs
├── .env                  — Hardcoded secrets and config
├── .gitignore
├── package.json
└── README.md
```

### Why I added `store.js`

You originally described an in-memory run store. Giving it its own module keeps the server logic cleaner and makes the dashboard and webhook flow easier to maintain.

---

## ENVIRONMENT VARIABLES

```env
GITHUB_TOKEN=your_personal_access_token
GITHUB_WEBHOOK_SECRET=probe_secret_2024
OPENAI_API_KEY=your_openai_key
PORT=3000
PROBE_COMMENT_TAG=<!-- probe:pr-intelligence -->
MAX_DIFF_CHARS=120000
MAX_FILES_FOR_REVIEWERS=20
OPENAI_MODEL=gpt-4o
```

### Reviewer changes added

- `PROBE_COMMENT_TAG`: helps Probe find and update its own existing PR comment.
- `MAX_DIFF_CHARS`: protects latency and token cost.
- `MAX_FILES_FOR_REVIEWERS`: prevents excessive GitHub API fanout on very large PRs.
- `OPENAI_MODEL`: keeps the model configurable without code edits.

---

## ENDPOINTS

### `POST /webhook`

Receives GitHub PR webhook events, verifies signature, checks event type, applies idempotency guard, triggers the Probe analysis pipeline, and returns fast acknowledgement.

### `GET /health`

Returns:

```json
{ "status": "ok", "service": "Probe" }
```

Used for deployment health checks.

### `GET /dashboard`

Serves a live HTML dashboard showing all PR runs with their cost, latency, risk level, token usage, timestamp, and run status. Auto-refreshes every 30 seconds.

### Reviewer change

If you want the live product to feel more trustworthy in a demo, the dashboard should show:

- total runs
- successful runs
- failed runs
- average cost per run
- average latency
- latest run timestamp

This makes the observability story noticeably stronger.

---

## THE LLM PROMPT

The following system prompt is sent to GPT for every PR analysis:

```text
You are Probe, a PR Intelligence Agent. Analyze the following pull request diff and return ONLY a valid JSON object with exactly these fields: code_review (2-4 sentences of specific actionable feedback referencing actual code from the diff), product_impact (2-3 sentences in plain English starting with "This change..." written for a non-technical PM), risk_score (an object with level as exactly "Low", "Medium", or "High" and reason as one sentence referencing specific systems touched), blast_radius (an object with files_changed as a number, modules_affected as an array of top-level directory names, and summary as one sentence), and changelog_entry (one clean past-tense user-facing sentence). Return only the JSON. No markdown, no explanation, no preamble.
```

### Reviewer prompt improvements

To improve reliability, the actual request should also include:

- repository name
- PR title
- PR body if present
- changed file list
- diff content
- instruction to say when the diff appears truncated

Recommended additions:

```text
If the diff appears incomplete or truncated, make your best effort and mention that limitation briefly inside code_review.
Do not invent code paths or systems that are not present in the input.
Keep all fields concise and production-safe.
```

### JSON reliability note

Use the SDK's structured output support or strict JSON parsing/validation in code. If parsing fails, fall back gracefully rather than failing the entire webhook pipeline.

---

## OBSERVABILITY DASHBOARD

The dashboard is served at `GET /dashboard` as a simple HTML page with no external dependencies. It reads from an in-memory array that is populated after every PR run.

The dashboard displays:

- total runs processed
- successful runs
- failed runs
- average cost per run in USD
- average latency in milliseconds
- latest run timestamp
- a table of every individual run showing PR number, repository, run status, risk level, files changed, modules affected, tokens used, cost, latency, and timestamp

The table is sorted newest-first and the page auto-refreshes every 30 seconds.

This is not a fake — it is a real, functional observability layer built into Probe from the first run.

---

## WHAT WE ARE BUILDING

- The core webhook server that receives GitHub PR events
- Webhook signature verification
- Event filtering and idempotency handling
- The GitHub API integration that fetches PR diffs and file committer history
- The GPT agent that analyzes the diff and returns structured JSON
- The comment formatter that converts the JSON into a clean markdown comment
- The GitHub API integration that creates or updates the Probe comment back on the PR
- The in-memory run store that logs cost, latency, metadata, and status for every run
- The live observability dashboard served at `GET /dashboard`

---

## WHAT WE ARE NOT BUILDING

- User authentication or login of any kind
- Multi-user account management
- Any frontend application beyond the observability dashboard
- A settings or configuration page
- A database or any persistent storage
- Multi-repo management
- Stripe or any payment integration
- Slack, Teams, or email notifications
- GitHub OAuth flow
- Auto-assigning reviewers on GitHub (we suggest, we do not assign)
- GitLab or Bitbucket support
- PR trend analytics or weekly digests
- Custom risk rules per team
- Advanced rate limiting or abuse prevention
- Unit tests
- CI/CD pipeline

### Reviewer note

Skipping tests is acceptable for a fast demo, but if you have time, even **one manual smoke-test checklist in the README** will make the project feel more solid.

---

## WHAT WE ARE FAKING

- GitHub token: hardcoded in `.env`, not entered by a real user
- Target repository: hardcoded, Probe does not dynamically connect to arbitrary repos
- Suggested Reviewers: simplified to last recent committers on changed files via GitHub API, not true domain expertise or workload-aware matching
- Pricing: we mention `$9/month per repo` in the demo narrative but there is no Stripe integration, no billing, and no actual charge

### Reviewer note

This is okay for MVP, but be explicit in the README that reviewer suggestions are **recency-based heuristics**, not ownership intelligence.

---

## BUILD ORDER

### Step 1

Project scaffold, `package.json`, file structure, `.env` setup.

### Step 2

Express server with `POST /webhook`, `GET /health`, and `GET /dashboard`.

### Step 3

Webhook signature verification using HMAC SHA-256.

### Step 4

Event filtering and idempotency guard using GitHub delivery IDs.

### Step 5

GitHub API integration — fetch PR diff and list of changed files.

### Step 6

Diff size control — trim oversized diffs and annotate when truncated.

### Step 7

GPT agent — send diff, receive structured JSON, calculate cost and latency.

### Step 8

GitHub API integration — fetch recent committers per changed file.

### Step 9

Comment formatter — convert all six outputs to clean markdown.

### Step 10

GitHub API integration — create or update a single Probe comment on the PR.

### Step 11

In-memory run store — log every run with metadata and status.

### Step 12

Observability dashboard — serve `GET /dashboard` with run history table.

### Step 13

Local testing with ngrok — configure GitHub webhook on test repo, open a PR, verify end-to-end.

### Step 14

Deploy to Railway — push to GitHub, set environment variables, update webhook URL.

### Step 15

Final end-to-end test on live deployment.

### Step 16

Polish comment formatting, add footer, prep the demo PR.

---

## 3-Hour Milestone Plan

This is the practical execution plan if the team has only **3 hours total** and must **ship a working live product** by the end.

### Core rule for the 3-hour build

We are not optimizing for completeness. We are optimizing for:

- one live deployed webhook
- one real PR event processed end-to-end
- one Probe comment posted back to GitHub
- one working dashboard showing the run

If a task does not directly help achieve those four outcomes, it is secondary.

### Scope freeze for the 3-hour version

The MVP we should ship in 3 hours includes:

- `POST /webhook`
- `GET /health`
- `GET /dashboard`
- webhook signature verification
- PR diff and changed file fetch
- GPT analysis with the required output fields
- simplified reviewer suggestions
- markdown comment post or update
- in-memory run logging
- live Railway deployment

The MVP we should **not** spend time polishing unless ahead of schedule:

- advanced prompt iteration
- perfect reviewer ranking
- multiple repo support
- deep HTML dashboard styling
- exhaustive edge-case handling
- README polish beyond setup and demo notes

---

## Milestone 0 — Setup Freeze

**Time box:** 0 to 15 minutes

**Goal:** Remove all setup uncertainty before coding.

**Tasks:**

- create the repo scaffold
- initialize `package.json`
- install core dependencies
- create `.env`
- confirm GitHub token, webhook secret, and OpenAI key are available
- choose one test repository for the demo
- create Railway project and keep it ready for deployment

**Definition of done:**

- project starts locally
- env vars are known
- test repo is chosen
- Railway target is ready

**If behind:** do not touch README or dashboard styling yet.

---

## Milestone 1 — Skeleton Server + Observability Base

**Time box:** 15 to 40 minutes

**Goal:** Have a running Express server with the basic routes and in-memory state.

**Tasks:**

- build `index.js`
- add Express server boot logic
- add `GET /health`
- add `GET /dashboard`
- create `store.js` with in-memory run storage and processed delivery IDs
- render a minimal HTML dashboard table

**Definition of done:**

- local server runs
- `/health` responds correctly
- `/dashboard` renders a basic page

**Why this matters:** It gives us a working shell early and reduces deployment risk later.

---

## Milestone 2 — Webhook Intake + GitHub Round Trip

**Time box:** 40 to 85 minutes

**Goal:** Prove that GitHub can hit the app and that the app can talk back to GitHub.

**Tasks:**

- implement raw-body webhook handling
- verify HMAC SHA-256 webhook signature
- filter for `pull_request.opened` and `pull_request.synchronize`
- add idempotency check using GitHub delivery ID
- fetch PR metadata, diff, and changed files from GitHub
- post a temporary static comment back to the PR

**Definition of done:**

- opening or syncing a PR triggers the webhook
- Probe successfully posts a basic comment on the PR

**Critical note:** This is the first true end-to-end proof. If this milestone works, shipping is realistic.

**If behind:** skip comment upsert until Milestone 4 and use simple create-comment first.

---

## Milestone 3 — AI Analysis + Structured Output

**Time box:** 85 to 130 minutes

**Goal:** Replace the static comment with the actual Probe intelligence output.

**Tasks:**

- build `agent.js`
- send PR context and diff to the OpenAI model
- parse/validate structured JSON
- calculate token usage, latency, and estimated cost
- add large-diff truncation guard
- add fallback behavior if the model response is invalid

**Definition of done:**

- webhook run returns usable AI analysis
- JSON is parsed successfully in normal cases
- failures do not crash the entire request flow

**If behind:** keep fallback simple and shorten the prompt instead of over-engineering parsing.

---

## Milestone 4 — Reviewer Suggestions + Final Comment Format

**Time box:** 130 to 160 minutes

**Goal:** Complete the product narrative by delivering all six sections in one clean comment.

**Tasks:**

- fetch recent committers for changed files
- dedupe usernames
- exclude PR author if possible
- cap reviewer list to a small number like 3 to 5
- build `formatter.js`
- format the six output sections into markdown
- add Probe comment tag
- implement comment upsert if time allows

**Definition of done:**

- one Probe comment contains all six sections
- reviewer suggestions appear
- markdown is readable and demo-friendly

**If behind:** comment formatting matters more than reviewer accuracy. Keep reviewer logic simple.

---

## Milestone 5 — Deploy, Test, and Lock the Demo

**Time box:** 160 to 180 minutes

**Goal:** Ship the live product and verify it in production.

**Tasks:**

- deploy to Railway
- set all env vars
- point GitHub webhook to the Railway URL
- trigger a real PR event
- confirm comment appears from the live deployment
- confirm dashboard shows the run
- do one final formatting cleanup only if time remains

**Definition of done:**

- live Railway deployment works
- one real PR receives the full Probe comment
- dashboard shows the live run

**Critical rule:** At this point, stop adding features. Only fix blockers that affect the demo path.

---

## Recommended Hour-by-Hour Execution

### Hour 1

Focus only on setup, server skeleton, dashboard shell, webhook verification, and GitHub round trip.

**Success checkpoint:** a PR event can make Probe post a static comment.

### Hour 2

Focus only on AI analysis, structured JSON parsing, truncation handling, and run logging.

**Success checkpoint:** the static comment becomes a real AI-generated Probe response.

### Hour 3

Focus only on reviewer suggestions, final markdown formatting, Railway deployment, and live end-to-end verification.

**Success checkpoint:** the live deployment posts the full six-section comment and logs it on the dashboard.

---

## Cut List If Time Slips

If you are running late, cut work in this order:

1. Fancy dashboard styling
2. Reopened PR support
3. Sophisticated reviewer ranking
4. Comment upsert refinement
5. Footer branding polish
6. Extra prompt tuning

Do **not** cut these:

- webhook signature verification
- GitHub diff fetch
- model analysis
- comment posting
- live deployment
- dashboard logging

---

## Hard MVP for a 3-Hour Ship

If the timeline gets very tight, the absolute minimum product that still counts as shipped is:

- live Railway webhook
- PR event received
- PR diff analyzed by the model
- single Probe markdown comment posted with all six headings
- dashboard page showing at least one recorded run

Anything beyond that is a bonus.

---

## DEFINITION OF DONE

Probe is shipped when:

- a pull request opened on the connected GitHub repository automatically receives a Probe comment within about 30 seconds for standard PR sizes
- the comment contains all six sections
- the comment is posted from the live Railway deployment, not ngrok
- follow-up PR sync events update the same Probe comment instead of creating duplicates
- the observability dashboard at `GET /dashboard` shows the run with correct cost, latency, risk level, and status

---

## FINAL RECOMMENDED MVP POSITIONING

If you pitch this in a demo, the strongest version of the story is:

**Probe is not another code reviewer. It is a PR intelligence layer for the whole team.**

That framing is stronger than just saying it is "CodeRabbit plus more." Your real edge is that the output is multi-stakeholder:

- developers get code review context
- PMs get product impact
- tech leads get risk
- engineering managers get blast radius
- reviewers get reviewer suggestions
- release owners get changelog text

That is a very good product narrative.

---

## Summary of Reviewer Changes Made to This Plan

I updated your original idea with the following changes to make it more viable:

1. Added **comment upsert behavior** instead of always posting a new comment.
2. Added **idempotency handling** for GitHub webhook retries.
3. Added **diff truncation controls** for latency, cost, and model reliability.
4. Added **fallback handling** for invalid model JSON or timeout cases.
5. Added **run status tracking** to the dashboard.
6. Improved **Suggested Reviewers** logic with dedupe and PR-author exclusion.
7. Added `store.js` and a few practical env vars for cleaner implementation.
8. Tightened the **Definition of Done** so the product behaves more credibly in a real demo.
9. Added a **3-hour milestone plan** with time boxes, cut-lines, and a realistic ship sequence.
