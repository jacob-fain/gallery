import { Request, Response } from 'express';
import nodemailer from 'nodemailer';

const CONTACT_EMAIL = 'jacobharryfain@gmail.com';

export const sendContactMessage = async (req: Request, res: Response) => {
  try {
    const { name, email, message } = req.body;

    // Validate input
    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, and message are required',
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

      await transporter.sendMail({
        from: `"${name}" <${smtpUser}>`,
        replyTo: email,
        to: CONTACT_EMAIL,
        subject: `Contact Form: Message from ${name}`,
        text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
        html: `
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <hr />
          <p>${message.replace(/\n/g, '<br />')}</p>
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
