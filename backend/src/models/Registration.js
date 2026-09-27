const mongoose = require("mongoose");

const registrationSchema = new mongoose.Schema(
  {
    competition: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Competition",
      required: true,
    },
    participantName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    registrationStatus: {
      type: String,
      enum: ["pending_payment", "confirmed", "cancelled"],
      default: "pending_payment",
    },
  },
  { timestamps: true }
);

// Prevent the same email from registering twice for one competition.
registrationSchema.index(
  { competition: 1, email: 1 },
  { unique: true }
);

module.exports = mongoose.model("Registration", registrationSchema);