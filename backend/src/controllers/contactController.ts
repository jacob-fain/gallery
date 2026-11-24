import { Request, Response } from 'express';
import nodemailer from 'nodemailer';

const CONTACT_EMAIL = 'jacobharryfain@gmail.com';

// Escape HTML to prevent XSS in emails
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * The form is on only when CONTACT_FORM_ENABLED is "true". In production it
 * also needs SMTP settings: without them a message would only reach the
 * server log while the visitor was told it was sent.
 */
export const contactAvailable = (env: NodeJS.ProcessEnv = process.env): boolean => {
  if (env.CONTACT_FORM_ENABLED !== 'true') return false;
  if (env.NODE_ENV !== 'production') return true;
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
};

export const sendContactMessage = async (req: Request, res: Response) => {
  if (!contactAvailable()) {
    return res.status(503).json({
      success: false,
      error: 'The contact form is not available right now.',
    });
  }
  try {
    const { name, email, message } = req.body;

    // Validate input
    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, and message are required',
      });
    }

    // Input length validation
    if (name.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Name must be 100 characters or less',
      });
    }
    if (email.length > 254) {
      return res.status(400).json({
        success: false,
        error: 'Email must be 254 characters or less',
      });
    }
    if (message.length > 5000) {
      return res.status(400).json({
        success: false,
        error: 'Message must be 5000 characters or less',
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email address',
      });
    }

    // Check if SMTP is configured
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (smtpHost && smtpUser && smtpPass) {
      // Send email via SMTP
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      const safeName = escapeHtml(name);
      const safeEmail = escapeHtml(email);
      const safeMessage = escapeHtml(message);

      await transporter.sendMail({
        from: `"${safeName}" <${smtpUser}>`,
        replyTo: email,
        to: CONTACT_EMAIL,
        subject: `Contact Form: Message from ${safeName}`,
        text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
        html: `
          <p><strong>Name:</strong> ${safeName}</p>
          <p><strong>Email:</strong> ${safeEmail}</p>
          <hr />
          <p>${safeMessage.replace(/\n/g, '<br />')}</p>
        `,
      });
    } else {
      // Log message if SMTP not configured (for development)
      console.log('=== Contact Form Submission ===');
      console.log(`From: ${name} <${email}>`);
      console.log(`Message: ${message}`);
      console.log('===============================');
    }

    res.json({ success: true, data: { sent: true } });
  } catch (err) {
    console.error('Error sending contact message:', err);
    res.status(500).json({ success: false, error: 'Failed to send message' });
  }
};
