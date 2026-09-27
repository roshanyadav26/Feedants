const mongoose = require("mongoose");

const entrySchema = new mongoose.Schema(
  {
    registration: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Registration",
      required: true,
    },

    participantName: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    competitionSlug: {
      type: String,
      required: true,
      trim: true,
    },

    video: {
      fileName: {
        type: String,
        required: true,
      },

      originalFileName: {
        type: String,
        required: true,
      },

      filePath: {
        type: String,
        required: true,
      },

      mimeType: {
        type: String,
        required: true,
      },

      fileSize: {
        type: Number,
        required: true,
      },
    },

    submissionStatus: {
      type: String,
      enum: ["submitted", "under_review", "accepted", "rejected"],
      default: "submitted",
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
  },
  {
    timestamps: true,
  }
);

// One entry per registration.
// Sparse allows older documents without a registration field.
entrySchema.index(
  { registration: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model("Entry", entrySchema);