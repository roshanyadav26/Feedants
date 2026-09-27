const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const Entry = require("../models/Entry");
const Registration = require("../models/Registration");
const Competition = require("../models/Competition");

const router = express.Router();
const backendDirectory = path.resolve(__dirname, "../..");
const uploadDirectory = path.join(backendDirectory, "uploads", "entries");
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDirectory),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("video/")) {
      return cb(null, true);
    }
    return cb(new Error("Only video files are allowed."));
  },
});

function removeUploadedFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    console.error("Could not remove untracked video:", error);
  }
}

function storedVideoPath(relativePath) {
  if (typeof relativePath !== "string") return null;
  const resolvedPath = path.resolve(backendDirectory, relativePath);
  const relativeToUploads = path.relative(uploadDirectory, resolvedPath);
  if (
    !relativeToUploads ||
    relativeToUploads.startsWith(`..${path.sep}`) ||
    relativeToUploads === ".." ||
    path.isAbsolute(relativeToUploads)
  ) {
    return null;
  }
  return resolvedPath;
}

function serializeEntry(entry) {
  return {
    id: entry._id,
    registration: entry.registration,
    participantName: entry.participantName,
    email: entry.email,
    competitionSlug: entry.competitionSlug,
    video: {
      fileName: entry.video.fileName,
      originalFileName: entry.video.originalFileName,
      mimeType: entry.video.mimeType,
      fileSize: entry.video.fileSize,
    },
    submissionStatus: entry.submissionStatus,
    paymentStatus: entry.paymentStatus,
    submittedAt: entry.submittedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

router.post("/upload", upload.single("video"), async (req, res) => {
  let uploadedFilePath = req.file?.path;

  try {
    const participantName =
      typeof req.body?.participantName === "string"
        ? req.body.participantName.trim()
        : "";
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const competitionSlug =
      typeof req.body?.competitionSlug === "string"
        ? req.body.competitionSlug.trim()
        : "";

    if (participantName.length < 2 || participantName.length > 80) {
      removeUploadedFile(uploadedFilePath);
      return res.status(400).json({
        message: "Participant name must be between 2 and 80 characters.",
      });
    }

    if (!emailPattern.test(email) || email.length > 254) {
      removeUploadedFile(uploadedFilePath);
      return res.status(400).json({ message: "Please enter a valid email address." });
    }

    if (
      !competitionSlug ||
      competitionSlug.length > 100 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(competitionSlug)
    ) {
      removeUploadedFile(uploadedFilePath);
      return res.status(400).json({ message: "Please provide a valid competition." });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Please attach a video file." });
    }

    const competition = await Competition.findOne({ slug: competitionSlug });
    if (!competition) {
      removeUploadedFile(uploadedFilePath);
      uploadedFilePath = null;
      return res.status(404).json({ message: "Competition not found." });
    }

    const registration = await Registration.findOne({
      competition: competition._id,
      email,
      registrationStatus: { $in: ["confirmed", "pending_payment"] },
    });

    if (!registration) {
      removeUploadedFile(uploadedFilePath);
      uploadedFilePath = null;
      return res.status(403).json({
        message: "No active registration was found for this email and competition.",
      });
    }

    const videoDetails = {
      fileName: req.file.filename,
      originalFileName: req.file.originalname,
      filePath: path.relative(backendDirectory, req.file.path),
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
    };
    const submittedAt = new Date();

    // One entry is allowed per registration. A later upload replaces its video.
    const existingEntry = await Entry.findOne({ registration: registration._id });
    if (existingEntry) {
      const oldFilePath = storedVideoPath(existingEntry.video?.filePath);

      existingEntry.participantName = registration.participantName;
      existingEntry.email = registration.email;
      existingEntry.competitionSlug = competition.slug;
      existingEntry.video = videoDetails;
      existingEntry.submissionStatus = "submitted";
      existingEntry.submittedAt = submittedAt;
      // Keep the payment snapshot unchanged; uploading never updates payment.
      await existingEntry.save();

      if (oldFilePath && oldFilePath !== uploadedFilePath) {
        removeUploadedFile(oldFilePath);
      }
      uploadedFilePath = null;

      return res.status(200).json({
        message: "Your video has been replaced and your entry status is submitted.",
        entry: serializeEntry(existingEntry),
      });
    }

    const entry = await Entry.create({
      registration: registration._id,
      participantName: registration.participantName,
      email: registration.email,
      competitionSlug: competition.slug,
      video: videoDetails,
      submissionStatus: "submitted",
      paymentStatus: registration.paymentStatus,
      submittedAt,
    });
    uploadedFilePath = null;

    return res.status(201).json({
      message: "Video uploaded and entry saved successfully.",
      entry: serializeEntry(entry),
    });
  } catch (error) {
    console.error("Entry upload error:", error);
    removeUploadedFile(uploadedFilePath);

    if (error.code === 11000 && error.keyPattern?.registration) {
      return res.status(409).json({
        message: "An entry upload is already being processed. Please refresh status and try again.",
      });
    }

    return res.status(500).json({
      message: "Video was received, but the entry could not be saved.",
    });
  }
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Video must be 100 MB or smaller." });
    }
    return res.status(400).json({ message: error.message });
  }

  if (error) {
    return res.status(400).json({ message: error.message || "Upload failed." });
  }

  return next();
});

module.exports = router;
