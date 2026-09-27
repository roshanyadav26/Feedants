const express = require("express");
const router = express.Router();

const Competition = require("../models/Competition");
const mongoose = require("mongoose");
const Registration = require("../models/Registration");
const Entry = require("../models/Entry");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const EmailOtp = require("../models/EmailOtp");
const { sendOtpEmail } = require("../utils/email");

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const STATUS_TOKEN_ISSUER = "feedants-participant-status";
const STATUS_TOKEN_AUDIENCE = "feedants-status-api";
const STATUS_TOKEN_TTL_SECONDS = 10 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getStatusTokenSecret() {
  const secret = process.env.PARTICIPANT_STATUS_TOKEN_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

function otpDigest(secret, competitionId, email, otp) {
  return crypto
    .createHmac("sha256", secret)
    .update(`feedants-participant-status-otp:v1:${competitionId}:${email}:${otp}`)
    .digest("hex");
}

function hashesMatch(left, right) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === 32 &&
    rightBuffer.length === 32 &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function statusTokenFromRequest(req, slug) {
  const secret = getStatusTokenSecret();
  if (!secret) {
    return { error: { status: 503, message: "Participant status verification is not configured." } };
  }

  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) {
    return { error: { status: 401, message: "A valid participant status token is required." } };
  }

  try {
    const claims = jwt.verify(match[1], secret, {
      algorithms: ["HS256"],
      issuer: STATUS_TOKEN_ISSUER,
      audience: STATUS_TOKEN_AUDIENCE,
    });
    if (
      claims.scope !== "participant_status" ||
      claims.competitionSlug !== slug ||
      !normalizeEmail(claims.sub)
    ) {
      return { error: { status: 401, message: "This token cannot access the requested status." } };
    }
    return { email: claims.sub };
  } catch (error) {
    return { error: { status: 401, message: "The participant status token is invalid or expired." } };
  }
}

function sendOtpAcknowledgement(res) {
  return res.status(202).json({
    message: "If the email is registered, a verification code will be sent.",
    resendAfterSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
  });
}

// Get published competition details
router.get("/:slug", async (req, res) => {
  try {
    const competition = await Competition.findOne({
      slug: req.params.slug,
      status: "published",
    });

    if (!competition) {
      return res.status(404).json({
        message: "Competition not found",
      });
    }

    const now = new Date();

    const registrationStatus =
      now < competition.registrationOpensAt
        ? "upcoming"
        : now <= competition.registrationClosesAt
        ? "open"
        : "closed";

    const competitionStatus =
      now < competition.startsAt
        ? "upcoming"
        : now <= competition.endsAt
        ? "live"
        : "completed";

    return res.json({
      ...competition.toObject(),
      registrationStatus,
      competitionStatus,
      remainingSpots: Math.max(
        competition.maxParticipants - competition.registeredCount,
        0
      ),
      isFull: competition.registeredCount >= competition.maxParticipants,
    });
  } catch (error) {
    console.error("Get competition error:", error);
    return res.status(500).json({
      message: "Server error",
    });
  }
});

// Register for a competition
router.post("/:slug/register", async (req, res) => {
  const participantName = String(req.body.participantName || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();

  if (participantName.length < 2 || participantName.length > 80) {
    return res.status(400).json({
      message: "Name must be between 2 and 80 characters.",
    });
  }

  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!emailIsValid || email.length > 254) {
    return res.status(400).json({
      message: "Please enter a valid email address.",
    });
  }

  const session = await mongoose.startSession();

  try {
    let createdRegistration;
    let updatedCompetition;

    await session.withTransaction(async () => {
      const competition = await Competition.findOne({
        slug: req.params.slug,
        status: "published",
      }).session(session);

      if (!competition) {
        const error = new Error("Competition not found.");
        error.statusCode = 404;
        throw error;
      }

      const now = new Date();

      if (
        now < competition.registrationOpensAt ||
        now > competition.registrationClosesAt ||
        now >= competition.startsAt
      ) {
        const error = new Error("Registration is not currently open.");
        error.statusCode = 400;
        throw error;
      }

      if (competition.registeredCount >= competition.maxParticipants) {
        const error = new Error("All participant slots are filled.");
        error.statusCode = 409;
        throw error;
      }

      // Atomically reserve one slot to prevent overbooking.
      updatedCompetition = await Competition.findOneAndUpdate(
        {
          _id: competition._id,
          status: "published",
          registrationOpensAt: { $lte: now },
          registrationClosesAt: { $gte: now },
          startsAt: { $gt: now },
          $expr: {
            $lt: ["$registeredCount", "$maxParticipants"],
          },
        },
        {
          $inc: { registeredCount: 1 },
        },
        {
          new: true,
          session,
        }
      );

      if (!updatedCompetition) {
        const error = new Error(
          "Registration closed or all participant slots are filled."
        );
        error.statusCode = 409;
        throw error;
      }

      [createdRegistration] = await Registration.create(
        [
          {
            competition: competition._id,
            participantName,
            email,
            paymentStatus: "pending",
            registrationStatus: "pending_payment",
          },
        ],
        { session }
      );
    });

    return res.status(201).json({
      message: "Registration created. Payment is still pending.",
      registration: {
        id: createdRegistration._id,
        participantName: createdRegistration.participantName,
        email: createdRegistration.email,
        paymentStatus: createdRegistration.paymentStatus,
        registrationStatus: createdRegistration.registrationStatus,
      },
      registeredCount: updatedCompetition.registeredCount,
      remainingSpots: Math.max(
        updatedCompetition.maxParticipants -
          updatedCompetition.registeredCount,
        0
      ),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "This email is already registered for this competition.",
      });
    }

    return res.status(error.statusCode || 500).json({
      message: error.message || "Could not complete registration.",
    });
  } finally {
    await session.endSession();
  }
});

// Always return the same acknowledgement for registered, unregistered,
// cooling-down, and email-delivery-failure cases to avoid account discovery.
router.post("/:slug/status/send-otp", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) {
    return res.status(400).json({
      message: "Please provide a valid email address.",
    });
  }

  const secret = getStatusTokenSecret();
  if (!secret) {
    return res.status(503).json({
      message: "Participant status verification is not configured.",
    });
  }

  try {
    const competition = await Competition.findOne({
      slug: req.params.slug,
      status: "published",
    }).select("_id slug");

    if (!competition) {
      return res.status(404).json({
        message: "Competition not found.",
      });
    }

    const registration = await Registration.exists({
      competition: competition._id,
      email,
    });
    if (!registration) return sendOtpAcknowledgement(res);

    const now = new Date();
    const otp = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
    const otpHash = otpDigest(secret, competition._id, email, otp);
    let otpRecord;

    try {
      otpRecord = await EmailOtp.findOneAndUpdate(
        {
          competition: competition._id,
          email,
          lastSentAt: { $lte: new Date(now.getTime() - OTP_RESEND_COOLDOWN_MS) },
        },
        {
          $set: {
            otpHash,
            expiresAt: new Date(now.getTime() + OTP_TTL_MS),
            attempts: 0,
            lastSentAt: now,
          },
          $setOnInsert: { competition: competition._id, email },
        },
        { new: true, upsert: true, runValidators: true }
      );
    } catch (error) {
      // A concurrent send may win the unique (competition, email) index.
      if (error.code === 11000) return sendOtpAcknowledgement(res);
      throw error;
    }

    try {
      await sendOtpEmail(email, otp);
    } catch {
      // Keep the cooldown record, but make this undelivered code unusable.
      try {
        await EmailOtp.updateOne(
          { _id: otpRecord._id, otpHash },
          {
            $set: {
              otpHash: otpDigest(secret, competition._id, email, "delivery-failed"),
              attempts: OTP_MAX_ATTEMPTS,
            },
          }
        );
      } catch {
        // The failed delivery remains unusable after the attempts are consumed.
      }
      console.error("Participant status OTP email delivery failed.");
    }

    return sendOtpAcknowledgement(res);
  } catch (error) {
    console.error("Participant status OTP request failed.");
    return res.status(500).json({
      message: "Could not process the verification request.",
    });
  }
});

router.post("/:slug/status/verify-otp", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const otp = typeof req.body?.otp === "string" ? req.body.otp.trim() : "";
  if (!email || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({
      message: "A valid email address and six-digit verification code are required.",
    });
  }

  const secret = getStatusTokenSecret();
  if (!secret) {
    return res.status(503).json({
      message: "Participant status verification is not configured.",
    });
  }

  try {
    const competition = await Competition.findOne({
      slug: req.params.slug,
      status: "published",
    }).select("_id slug");

    if (!competition) {
      return res.status(404).json({ message: "Competition not found." });
    }

    const now = new Date();
    const savedOtp = await EmailOtp.findOne({
      competition: competition._id,
      email,
      expiresAt: { $gt: now },
      attempts: { $lt: OTP_MAX_ATTEMPTS },
    });
    if (!savedOtp) {
      return res.status(400).json({ message: "Invalid or expired verification code." });
    }

    // Increment atomically before checking the code, including for wrong codes.
    const attemptedOtp = await EmailOtp.findOneAndUpdate(
      {
        _id: savedOtp._id,
        expiresAt: { $gt: now },
        attempts: { $lt: OTP_MAX_ATTEMPTS },
      },
      { $inc: { attempts: 1 } },
      { new: true }
    );
    if (!attemptedOtp) {
      return res.status(400).json({ message: "Invalid or expired verification code." });
    }

    const candidateHash = otpDigest(secret, competition._id, email, otp);
    if (!hashesMatch(candidateHash, attemptedOtp.otpHash)) {
      return res.status(400).json({ message: "Invalid or expired verification code." });
    }

    // Consume the code atomically while retaining lastSentAt for the cooldown.
    const consumed = await EmailOtp.findOneAndUpdate(
      {
        _id: attemptedOtp._id,
        attempts: attemptedOtp.attempts,
        otpHash: attemptedOtp.otpHash,
        expiresAt: { $gt: new Date() },
      },
      {
        $set: {
          otpHash: otpDigest(secret, competition._id, email, "consumed"),
          attempts: OTP_MAX_ATTEMPTS,
        },
      },
      { new: true }
    );
    if (!consumed) {
      return res.status(400).json({ message: "Invalid or expired verification code." });
    }

    const accessToken = jwt.sign(
      { scope: "participant_status", competitionSlug: competition.slug },
      secret,
      {
        algorithm: "HS256",
        subject: email,
        expiresIn: STATUS_TOKEN_TTL_SECONDS,
        issuer: STATUS_TOKEN_ISSUER,
        audience: STATUS_TOKEN_AUDIENCE,
      }
    );
    return res.status(200).json({
      accessToken,
      tokenType: "Bearer",
      expiresIn: STATUS_TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    console.error("Participant status OTP verification failed.");
    return res.status(500).json({
      message: "Could not verify the code.",
    });
  }
});

// Status details are returned only after a short-lived token proves email access.
router.get("/:slug/status", async (req, res) => {
  const authorization = statusTokenFromRequest(req, req.params.slug);
  if (authorization.error) {
    return res.status(authorization.error.status).json({
      message: authorization.error.message,
    });
  }

  try {
    const competition = await Competition.findOne({
      slug: req.params.slug,
      status: "published",
    }).select("_id slug");

    if (!competition) {
      return res.status(404).json({ message: "Competition not found." });
    }

    const registration = await Registration.findOne({
      competition: competition._id,
      email: authorization.email,
    }).select("_id paymentStatus registrationStatus");

    if (!registration) {
      return res.status(404).json({ message: "Participant status unavailable." });
    }

    const entry = await Entry.findOne({
      registration: registration._id,
    }).select("submissionStatus createdAt updatedAt");

    return res.json({
      registrationStatus: registration.registrationStatus,
      paymentStatus: registration.paymentStatus,
      submissionStatus: entry ? entry.submissionStatus : null,
      submittedAt: entry ? entry.createdAt : null,
      lastUpdatedAt: entry ? entry.updatedAt : null,
    });
  } catch (error) {
    console.error("Participant status lookup failed.");
    return res.status(500).json({
      message: "Could not retrieve participant status.",
    });
  }
});

module.exports = router;
