const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const Entry = require("../models/Entry");
const Registration = require("../models/Registration");
const Competition = require("../models/Competition");

const router = express.Router();

const uploadDirectory = path.resolve(
  __dirname,
  "../../uploads/entries"
);

fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDirectory);
  },

  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();

    const uniqueName = `${Date.now()}-${Math.round(
      Math.random() * 1e9
    )}${extension}`;

    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed."));
    }
  },
});

router.post("/upload", upload.single("video"), async (req, res) => {
  let uploadedFilePath;
  let oldFilePath;

  try {
    const { participantName, email, competitionSlug } = req.body;

    if (!participantName || !email || !competitionSlug) {
      return res.status(400).json({
        message:
          "Participant name, email, and competition are required.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        message: "Please attach a video file.",
      });
    }

    uploadedFilePath = req.file.path;

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedSlug = competitionSlug.trim();

    const competition = await Competition.findOne({
      slug: normalizedSlug,
    });

    if (!competition) {
      return res.status(404).json({
        message: "Competition not found.",
      });
    }

    const registration = await Registration.findOne({
      competition: competition._id,
      email: normalizedEmail,
      registrationStatus: "confirmed",
    });

    if (!registration) {
      return res.status(403).json({
        message:
          "A confirmed registration is required before uploading a video.",
      });
    }

    const videoDetails = {
      fileName: req.file.filename,
      originalFileName: req.file.originalname,
      filePath: path.relative(
        path.resolve(__dirname, "../.."),
        req.file.path
      ),
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
    };

    // If an entry already exists for this registration,
    // replace its video instead of creating another entry.
    const existingEntry = await Entry.findOne({
      registration: registration._id,
    });

    if (existingEntry) {
      oldFilePath = path.resolve(
        path.resolve(__dirname, "../.."),
        existingEntry.video.filePath
      );

      existingEntry.participantName = registration.participantName;
      existingEntry.email = registration.email;
      existingEntry.competitionSlug = normalizedSlug;
      existingEntry.video = videoDetails;
      existingEntry.submissionStatus = "submitted";
      existingEntry.paymentStatus = registration.paymentStatus;

      await existingEntry.save();

      // Delete the old video only after the database update succeeds.
      if (
        oldFilePath &&
        oldFilePath !== uploadedFilePath &&
        fs.existsSync(oldFilePath)
      ) {
        try {
          fs.unlinkSync(oldFilePath);
        } catch (cleanupError) {
          console.error(
            "Could not remove replaced video:",
            cleanupError
          );
        }
      }

      uploadedFilePath = null;

      return res.status(200).json({
        message: "Your video has been replaced successfully.",
        entry: {
          id: existingEntry._id,
          registration: existingEntry.registration,
          participantName: existingEntry.participantName,
          email: existingEntry.email,
          competitionSlug: existingEntry.competitionSlug,
          video: existingEntry.video,
          submissionStatus: existingEntry.submissionStatus,
          paymentStatus: existingEntry.paymentStatus,
          createdAt: existingEntry.createdAt,
          updatedAt: existingEntry.updatedAt,
        },
      });
    }

    // No entry exists yet, so create the first submission.
    const entry = await Entry.create({
      registration: registration._id,
      participantName: registration.participantName,
      email: registration.email,
      competitionSlug: normalizedSlug,
      video: videoDetails,
      submissionStatus: "submitted",
      paymentStatus: registration.paymentStatus,
    });

    uploadedFilePath = null;

    return res.status(201).json({
      message: "Video uploaded and entry saved successfully.",
      entry: {
        id: entry._id,
        registration: entry.registration,
        participantName: entry.participantName,
        email: entry.email,
        competitionSlug: entry.competitionSlug,
        video: entry.video,
        submissionStatus: entry.submissionStatus,
        paymentStatus: entry.paymentStatus,
        createdAt: entry.createdAt,
      },
    });
  } catch (error) {
    console.error("Entry upload error:", error);

    // Remove the newly uploaded file if the database operation failed.
    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      try {
        fs.unlinkSync(uploadedFilePath);
      } catch (cleanupError) {
        console.error(
          "Could not remove untracked video:",
          cleanupError
        );
      }
    }

    if (error.code === 11000 && error.keyPattern?.registration) {
      return res.status(409).json({
        message:
          "An entry already exists for this registration. Please try replacing the video again.",
      });
    }

    return res.status(500).json({
      message: "Video was received, but the entry could not be saved.",
    });
  }
});

// Handle Multer and upload errors.
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        message: "Video must be 100 MB or smaller.",
      });
    }

    return res.status(400).json({
      message: error.message,
    });
  }

  if (error) {
    return res.status(400).json({
      message: error.message || "Upload failed.",
    });
  }

  next();
});

module.exports = router;