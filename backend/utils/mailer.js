const nodemailer = require('nodemailer');
const smtpConfig = require('../config/smtp');

let transporter = null;
if (smtpConfig.host && smtpConfig.auth.user && smtpConfig.auth.pass) {
  transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: {
      user: smtpConfig.auth.user,
      pass: smtpConfig.auth.pass
    }
  });
} else {
  console.warn('SMTP not configured - emails will be logged but not sent. Fill backend/config/smtp.js or set SMTP_* env vars.');
}

const sendMail = async ({ to, subject, text, html }) => {
  if (!transporter) {
    console.log(`Email (stub) to: ${to} subject: ${subject}\n${text || html}`);
    return Promise.resolve();
  }

  const mailOptions = {
    from: smtpConfig.from,
    to,
    subject,
    text,
    html
  };

  return transporter.sendMail(mailOptions);
};

module.exports = { sendMail };
