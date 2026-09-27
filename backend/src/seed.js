
require("dotenv").config();

const mongoose = require("mongoose");
const Competition = require("./models/Competition");

async function seedCompetition() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    await Competition.findOneAndUpdate(
      { slug: "dance-championship-2026" },
      {
        $set: {
          title: "Feedants Dance Championship",
          category: "Dance",
          description:
            "Show your talent and compete with dancers from across the community.",
          prizePool: 50000,
          entryFee: 199,
          maxParticipants: 500,
          registeredCount: 0,
          registrationOpensAt:
            new Date("2026-09-27T00:00:00Z"),
          registrationClosesAt:
            new Date("2026-10-15T23:59:59Z"),
          startsAt:
            new Date("2026-11-01T00:00:00Z"),
          endsAt:
            new Date("2026-11-30T23:59:59Z"),
          status: "published",
        },
      },
      {
  upsert: true,
  returnDocument: "after",
  runValidators: true,
}
    );

    console.log("Demo competition created successfully");
  } catch (error) {
    console.error("Seeding failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

seedCompetition();