const { Resend } = require("resend");

function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

function generateEmailHTML(content) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; background-color: #030712; font-family: 'Inter', Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <div style="background-color: #030712; padding: 40px 20px;">
    <!-- Main Card -->
    <div style="max-width: 500px; margin: 0 auto; background: #0b1120; border: 1px solid #1e3a8a; border-top: 4px solid #3b82f6; border-radius: 12px; padding: 40px 30px; box-shadow: 0 0 30px rgba(59, 130, 246, 0.15); text-align: center;">
      
      <!-- Branding / Logo Text -->
      <div style="margin-bottom: 25px;">
        <h1 style="margin: 0; color: #60a5fa; font-size: 22px; font-weight: 800; letter-spacing: 4px; text-transform: uppercase; text-shadow: 0 0 10px rgba(96, 165, 250, 0.4);">
          ALSHAYEB EXPERIENCE
        </h1>
        <p style="margin: 12px 0 0; color: #4b5563; font-size: 11px; font-weight: 400; letter-spacing: 2px;">
          NO BEGINNING. NO END.
        </p>
      </div>
      
      <!-- Divider -->
      <div style="height: 1px; background: linear-gradient(90deg, transparent, #1e3a8a, transparent); margin: 30px 0;"></div>
      
      <!-- Dynamic Content -->
      <div style="font-size: 16px; line-height: 1.6; color: #d1d5db; margin-bottom: 35px;">
        ${content.split('\n').map(line => `<p style="margin: 0 0 10px;">${line}</p>`).join('')}
      </div>
      
      <!-- Call To Action Button -->
      <div style="margin-top: 40px;">
        <a href="https://alshayebexperience.com/?page=trackLookup" style="display: inline-block; background: transparent; color: #60a5fa; padding: 14px 28px; text-decoration: none; border: 1px solid #3b82f6; border-radius: 4px; font-weight: 600; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; transition: all 0.3s ease; box-shadow: inset 0 0 10px rgba(59, 130, 246, 0.1), 0 0 10px rgba(59, 130, 246, 0.1);">
          TRACK YOUR APPLICATION
        </a>
      </div>
      
      <!-- Footer Text -->
      <div style="margin-top: 40px; font-size: 12px; color: #4b5563;">
        <p style="margin: 0;">This is an automated message from the ALSHAYEB Selection Committee.</p>
        <p style="margin: 5px 0 0;">Please do not reply directly to this email.</p>
      </div>
      
    </div>
  </div>
</body>
</html>
  `;
}

async function sendStatusEmail(attendee, subject, message) {
  if (!attendee?.email || !isResendConfigured()) {
    return false;
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const htmlContent = generateEmailHTML(message);

  try {
    const { data, error } = await resend.emails.send({
      from: "ALSHAYEB Experience <selection@alshayebexperience.com>",
      to: [attendee.email],
      subject: subject,
      text: message,
      html: htmlContent
    });

    if (error) {
      console.error("Resend API rejected email:", {
        attendeeId: attendee._id,
        email: attendee.email,
        error
      });
      return false; // don't throw, just return false so we don't block
    }

    return true;
  } catch (error) {
    console.error("Resend SDK unexpected error:", {
      attendeeId: attendee._id,
      email: attendee.email,
      error: error.message
    });
    return false; // don't throw
  }
}

module.exports = {
  sendStatusEmail
};
