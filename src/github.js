const { Octokit } = require("@octokit/rest");

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const MAX_DIFF_CHARS = parseInt(process.env.MAX_DIFF_CHARS || "120000", 10);
const MAX_FILES_FOR_REVIEWERS = parseInt(
  process.env.MAX_FILES_FOR_REVIEWERS || "20",
  10
);
const COMMENT_TAG = process.env.PROBE_COMMENT_TAG || "<!-- probe:pr-intelligence -->";

/**
 * Fetch list of changed files for a PR.
 */
async function getChangedFiles(owner, repo, pullNumber) {
  const files = [];
  let page = 1;
  while (true) {
    const { data } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
      page,
    });
    files.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return files;
}

/**
 * Fetch the PR diff as a string. Truncate if too large.
 * Returns { diff, truncated }
 */
async function getPRDiff(owner, repo, pullNumber) {
  const { data } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
    mediaType: { format: "diff" },
  });

  const diff = typeof data === "string" ? data : String(data);

  if (diff.length > MAX_DIFF_CHARS) {
    return {
      diff: diff.substring(0, MAX_DIFF_CHARS),
      truncated: true,
    };
  }

  return { diff, truncated: false };
}

/**
 * Fetch recent committers for the given files.
 * Excludes the PR author and deduplicates.
 */
async function getSuggestedReviewers(owner, repo, files, prAuthor) {
  const reviewerSet = new Set();
  const filesToCheck = files.slice(0, MAX_FILES_FOR_REVIEWERS);

  for (const file of filesToCheck) {
    try {
      const { data: commits } = await octokit.repos.listCommits({
        owner,
        repo,
        path: file.filename,
        per_page: 5,
      });

      for (const commit of commits) {
        const login = commit.author?.login;
        if (login && login !== prAuthor) {
          reviewerSet.add(login);
        }
      }
    } catch {
      // Skip files that error (e.g., new files with no commit history)
    }
  }

  return Array.from(reviewerSet);
}

/**
 * Create or update the Probe comment on a PR.
 * Uses the COMMENT_TAG to find an existing Probe comment.
 */
async function upsertComment(owner, repo, pullNumber, commentBody) {
  const body = `${COMMENT_TAG}\n\n${commentBody}`;

  // Search for existing Probe comment
  let existingCommentId = null;
  let page = 1;
  while (true) {
    const { data: comments } = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: pullNumber,
      per_page: 100,
      page,
    });

    for (const comment of comments) {
      if (comment.body && comment.body.includes(COMMENT_TAG)) {
        existingCommentId = comment.id;
        break;
      }
    }

    if (existingCommentId || comments.length < 100) break;
    page++;
  }

  if (existingCommentId) {
    await octokit.issues.updateComment({
      owner,
      repo,
      comment_id: existingCommentId,
      body,
    });
    return { action: "updated", commentId: existingCommentId };
  } else {
    const { data } = await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body,
    });
    return { action: "created", commentId: data.id };
  }
}

module.exports = {
  getChangedFiles,
  getPRDiff,
  getSuggestedReviewers,
  upsertComment,
};
