
const mongoose = require("mongoose");

const competitionSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    category: {
      type: String,
      required: true,
    },

    description: {
      type: String,
      required: true,
    },

    prizePool: {
      type: Number,
      required: true,
      min: 0,
    },

    entryFee: {
      type: Number,
      required: true,
      min: 0,
    },

    maxParticipants: {
      type: Number,
      required: true,
      min: 1,
    },

    registeredCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    registrationOpensAt: {
      type: Date,
      required: true,
    },

    registrationClosesAt: {
      type: Date,
      required: true,
    },

    startsAt: {
      type: Date,
      required: true,
    },

    endsAt: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      enum: ["draft", "published", "cancelled"],
      default: "published",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "Competition",
  competitionSchema
);