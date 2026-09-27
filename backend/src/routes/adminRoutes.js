const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Entry = require("../models/Entry");
const Registration = require("../models/Registration");
const { ADMIN_AUDIENCE, ADMIN_ISSUER, getJwtSecret, requireAdmin } = require("../middleware/adminAuth");

const router = express.Router();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const loginAttempts = new Map();
const REGISTRATION_STATUSES = ["pending_payment", "confirmed", "cancelled"];
const SUBMISSION_STATUSES = ["submitted", "under_review", "accepted", "rejected"];

function loginRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || "unknown";

  // Prune expired keys so the in-memory limiter remains bounded over time.
  for (const [ip, attempt] of loginAttempts) {
    if (now - attempt.windowStartedAt >= LOGIN_WINDOW_MS) {
      loginAttempts.delete(ip);
    }
  }

  const attempt = loginAttempts.get(key);
  if (attempt && now - attempt.windowStartedAt < LOGIN_WINDOW_MS &&
      attempt.failed >= MAX_FAILED_LOGINS) {
    const retryAfterSeconds = Math.ceil(
      (LOGIN_WINDOW_MS - (now - attempt.windowStartedAt)) / 1000
    );
    res.set("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({
      message: "Too many failed login attempts. Try again later.",
      retryAfterSeconds,
    });
  }

  req.loginAttemptKey = key;
  return next();
}

function recordFailedLogin(key) {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || now - current.windowStartedAt >= LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { windowStartedAt: now, failed: 1 });
    return;
  }
  current.failed += 1;
}

function parsePagination(query) {
  const pageValue = query.page === undefined ? "1" : query.page;
  const limitValue = query.limit === undefined ? "20" : query.limit;
  if (
    typeof pageValue !== "string" ||
    typeof limitValue !== "string" ||
    !/^\d+$/.test(pageValue) ||
    !/^\d+$/.test(limitValue)
  ) {
    return { error: "page and limit must be positive integers." };
  }
  const page = Number(pageValue);
  const limit = Number(limitValue);
  if (!Number.isSafeInteger(page) || page < 1) {
    return { error: "page must be a positive integer." };
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return { error: "limit must be between 1 and 100." };
  }
  return { page, limit };
}

function paginationResponse(page, limit, total) {
  return {
    page,
    limit,
    totalItems: total,
    totalPages: Math.ceil(total / limit),
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

router.post("/login", loginRateLimit, async (req, res) => {
  const email = typeof req.body?.email === "string"
    ? req.body.email.trim().toLowerCase()
    : "";
  const password = typeof req.body?.password === "string"
    ? req.body.password
    : "";

  if (!email || !password) {
    recordFailedLogin(req.loginAttemptKey);
    return res.status(400).json({
      message: "Email and password are required.",
      errors: { email: !email ? "Required." : undefined, password: !password ? "Required." : undefined },
    });
  }

  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  const secret = getJwtSecret();
  if (!adminEmail || !passwordHash || !secret) {
    return res.status(503).json({
      message: "Admin authentication is not configured.",
    });
  }

  let passwordMatches = false;
  try {
    // Compare even when the supplied email differs to reduce timing differences.
    passwordMatches = await bcrypt.compare(password, passwordHash);
  } catch (error) {
    return res.status(503).json({
      message: "Admin authentication is not configured correctly.",
    });
  }

  if (email !== adminEmail || !passwordMatches) {
    recordFailedLogin(req.loginAttemptKey);
    return res.status(401).json({ message: "Invalid email or password." });
  }

  loginAttempts.delete(req.loginAttemptKey);
  const token = jwt.sign(
    { sub: adminEmail, role: "admin" },
    secret,
    {
      algorithm: "HS256",
      expiresIn: "1h",
      issuer: ADMIN_ISSUER,
      audience: ADMIN_AUDIENCE,
    }
  );
  return res.status(200).json({
    token,
    tokenType: "Bearer",
    expiresIn: 3600,
  });
});

router.use(requireAdmin);

router.get("/registrations", async (req, res) => {
  const pagination = parsePagination(req.query);
  if (pagination.error) {
    return res.status(400).json({ message: pagination.error });
  }

  const filter = {};
  if (req.query.email !== undefined) {
    if (typeof req.query.email !== "string" || !req.query.email.trim()) {
      return res.status(400).json({ message: "email must be a non-empty string." });
    }
    filter.email = new RegExp(escapeRegex(req.query.email.trim().toLowerCase()), "i");
  }
  if (req.query.registrationStatus !== undefined) {
    if (!REGISTRATION_STATUSES.includes(req.query.registrationStatus)) {
      return res.status(400).json({
        message: "Invalid registrationStatus.",
        allowedValues: REGISTRATION_STATUSES,
      });
    }
    filter.registrationStatus = req.query.registrationStatus;
  }

  try {
    const { page, limit } = pagination;
    const [registrations, total] = await Promise.all([
      Registration.find(filter)
        .populate("competition", "slug title")
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Registration.countDocuments(filter),
    ]);
    return res.status(200).json({
      registrations,
      pagination: paginationResponse(page, limit, total),
    });
  } catch (error) {
    return res.status(500).json({ message: "Could not retrieve registrations." });
  }
});

router.get("/entries", async (req, res) => {
  const pagination = parsePagination(req.query);
  if (pagination.error) {
    return res.status(400).json({ message: pagination.error });
  }

  const filter = {};
  if (req.query.competition !== undefined) {
    if (typeof req.query.competition !== "string" || !req.query.competition.trim()) {
      return res.status(400).json({ message: "competition must be a non-empty slug." });
    }
    filter.competitionSlug = req.query.competition.trim();
  }
  if (req.query.submissionStatus !== undefined) {
    if (!SUBMISSION_STATUSES.includes(req.query.submissionStatus)) {
      return res.status(400).json({
        message: "Invalid submissionStatus.",
        allowedValues: SUBMISSION_STATUSES,
      });
    }
    filter.submissionStatus = req.query.submissionStatus;
  }

  try {
    const { page, limit } = pagination;
    const [entries, total] = await Promise.all([
      Entry.find(filter)
        .populate("registration", "participantName email registrationStatus paymentStatus")
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Entry.countDocuments(filter),
    ]);
    return res.status(200).json({
      entries,
      pagination: paginationResponse(page, limit, total),
    });
  } catch (error) {
    return res.status(500).json({ message: "Could not retrieve video entries." });
  }
});

router.patch("/entries/:id/status", async (req, res) => {
  const { id } = req.params;
  if (!/^[a-f\d]{24}$/i.test(id)) {
    return res.status(400).json({ message: "Entry id must be a valid MongoDB id." });
  }
  if (
    !req.body ||
    typeof req.body.submissionStatus !== "string" ||
    !SUBMISSION_STATUSES.includes(req.body.submissionStatus)
  ) {
    return res.status(400).json({
      message: "A valid submissionStatus is required.",
      allowedValues: SUBMISSION_STATUSES,
    });
  }

  try {
    const entry = await Entry.findByIdAndUpdate(
      id,
      { $set: { submissionStatus: req.body.submissionStatus } },
      { new: true, runValidators: true }
    ).lean();
    if (!entry) {
      return res.status(404).json({ message: "Entry not found." });
    }
    return res.status(200).json({ entry });
  } catch (error) {
    return res.status(500).json({ message: "Could not update entry review status." });
  }
});

module.exports = router;
