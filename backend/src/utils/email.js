const nodemailer = require("nodemailer");

function isEmailEnabled() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.EMAIL_FROM);
}

function createTransporter() {
  if (!isEmailEnabled()) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendStatusEmail(attendee, subject, message) {
  if (!attendee?.email || !isEmailEnabled()) {
    return false;
  }

  const transporter = createTransporter();

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: attendee.email,
      subject,
      text: message,
      html: `<p>${message}</p>`
    });
    return true;
  } catch (error) {
    console.error("Email notification failed:", {
      attendeeId: attendee._id,
      email: attendee.email,
      subject,
      error: error.message
    });
    return false;
  }
}

module.exports = {
  sendStatusEmail
};
