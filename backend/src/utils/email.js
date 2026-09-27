const nodemailer = require("nodemailer");

const emailUser = process.env.EMAIL_USER;
const emailAppPassword = process.env.EMAIL_APP_PASSWORD;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: emailUser,
    pass: emailAppPassword,
  },
  // Bound background delivery work when the SMTP provider is unresponsive.
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 15_000,
});

async function sendOtpEmail(to, otp) {
  if (!emailUser || !emailAppPassword) {
    throw new Error("Email credentials are not configured.");
  }

  await transporter.sendMail({
    from: `"Feedants" <${emailUser}>`,
    to,
    subject: "Your Feedants verification code",
    text: `Your Feedants verification code is ${otp}. It expires in 10 minutes. Do not share this code with anyone.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>Feedants email verification</h2>
        <p>Your verification code is:</p>
        <h1 style="letter-spacing: 6px;">${otp}</h1>
        <p>This code expires in 10 minutes. Do not share it with anyone.</p>
      </div>
    `,
  });
}

module.exports = { sendOtpEmail };
