
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const competitionRoutes = require("./routes/competitionRoutes");
const entryRoutes = require("./routes/entryRoutes");
const adminRoutes = require("./routes/adminRoutes");
const app = express();
app.use(express.json());
app.use(cors());
app.use("/api/competitions", competitionRoutes);
app.use("/api/entries", entryRoutes);
app.use("/api/admin", adminRoutes);
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Feedants backend is running",
  });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    if (process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log("MongoDB connected successfully");
    } else {
      console.log("MongoDB URI not configured yet");
    }

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
