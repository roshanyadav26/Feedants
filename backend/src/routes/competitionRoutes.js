const express = require("express");
const router = express.Router();
const Competition = require("../models/Competition");
const mongoose = require("mongoose");
const Registration = require("../models/Registration");

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

    res.json({
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
    res.status(500).json({ message: "Server error" });
  }
});
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

      // Atomically reserve one slot. The condition prevents overbooking
      // if multiple people register at the same time.
      updatedCompetition = await Competition.findOneAndUpdate(
        {
          _id: competition._id,
          status: "published",
          registrationOpensAt: { $lte: now },
          registrationClosesAt: { $gte: now },
          startsAt: { $gt: now },
          $expr: { $lt: ["$registeredCount", "$maxParticipants"] },
        },
        { $inc: { registeredCount: 1 } },
        { new: true, session }
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
module.exports = router;