const crypto = require("crypto");
const store = require("./store");

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

/**
 * Verify GitHub webhook HMAC SHA-256 signature.
 * Returns true if valid, false otherwise.
 */
function verifySignature(payload, signature) {
  if (!signature) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

/**
 * Determine if this webhook event should be processed.
 * Returns { shouldProcess: boolean, reason: string }
 */
function filterEvent(headers, body) {
  const event = headers["x-github-event"];
  if (event !== "pull_request") {
    return { shouldProcess: false, reason: `Ignored event type: ${event}` };
  }

  const action = body.action;
  const allowed = ["opened", "synchronize", "reopened"];
  if (!allowed.includes(action)) {
    return { shouldProcess: false, reason: `Ignored PR action: ${action}` };
  }

  return { shouldProcess: true, reason: "ok" };
}

/**
 * Idempotency guard. Returns true if this delivery was already processed.
 */
function isDuplicate(deliveryId) {
  if (!deliveryId) return false;
  if (store.hasDelivery(deliveryId)) {
    return true;
  }
  store.markDelivery(deliveryId);
  return false;
}

module.exports = { verifySignature, filterEvent, isDuplicate };
