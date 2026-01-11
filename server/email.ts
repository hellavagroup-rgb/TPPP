import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// From address - defaults to Resend sandbox for testing, should be set to verified domain in production
const FROM_EMAIL = process.env.FROM_EMAIL || 'The Perinatal Psychology Practice <onboarding@resend.dev>';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (error) {
      console.error('Email send error:', error);
      return { success: false, error: error.message };
    }

    console.log('Email sent successfully:', data?.id);
    return { success: true };
  } catch (err) {
    console.error('Email send exception:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ============ EMAIL TEMPLATES ============

export function generateFormInviteEmail(clientDisplayId: string, formName: string, formUrl: string): EmailOptions {
  return {
    to: '', // Will be set by caller
    subject: `Please Complete: ${formName} - The Perinatal Psychology Practice`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
            .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>The Perinatal Psychology Practice</h1>
            </div>
            <div class="content">
              <p>Dear Client (Ref: ${clientDisplayId}),</p>
              <p>We have a form for you to complete as part of your intake process:</p>
              <p><strong>${formName}</strong></p>
              <p>Please click the button below to access and complete the form:</p>
              <p style="text-align: center;">
                <a href="${formUrl}" class="button">Complete Form</a>
              </p>
              <p>If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="word-break: break-all; font-size: 12px; color: #666;">${formUrl}</p>
              <p>If you have any questions, please don't hesitate to contact us.</p>
              <p>Best regards,<br>The Perinatal Psychology Practice Team</p>
            </div>
            <div class="footer">
              <p>This email was sent by The Perinatal Psychology Practice. Please do not reply directly to this email.</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Dear Client (Ref: ${clientDisplayId}),\n\nPlease complete the following form: ${formName}\n\nAccess it here: ${formUrl}\n\nBest regards,\nThe Perinatal Psychology Practice Team`,
  };
}

export function generatePasswordResetEmail(userName: string, resetUrl: string): EmailOptions {
  return {
    to: '', // Will be set by caller
    subject: 'Password Reset - The Perinatal Psychology Practice',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; margin: 20px 0; }
            .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 12px; border-radius: 4px; margin: 15px 0; }
            .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Password Reset</h1>
            </div>
            <div class="content">
              <p>Hello ${userName},</p>
              <p>We received a request to reset your password. Click the button below to set a new password:</p>
              <p style="text-align: center;">
                <a href="${resetUrl}" class="button">Reset Password</a>
              </p>
              <div class="warning">
                <strong>Security Notice:</strong> This link will expire in 1 hour. If you didn't request this reset, please ignore this email.
              </div>
              <p>If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="word-break: break-all; font-size: 12px; color: #666;">${resetUrl}</p>
            </div>
            <div class="footer">
              <p>The Perinatal Psychology Practice</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Hello ${userName},\n\nWe received a request to reset your password.\n\nReset your password here: ${resetUrl}\n\nThis link will expire in 1 hour. If you didn't request this reset, please ignore this email.\n\nThe Perinatal Psychology Practice`,
  };
}

export function generateTaskReminderEmail(assigneeName: string, taskTitle: string, taskDescription: string, dueDate: string): EmailOptions {
  return {
    to: '', // Will be set by caller
    subject: `Task Reminder: ${taskTitle} - Due ${dueDate}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
            .task-box { background: white; border: 1px solid #ddd; border-radius: 6px; padding: 20px; margin: 15px 0; }
            .due-date { color: #dc3545; font-weight: bold; }
            .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Task Reminder</h1>
            </div>
            <div class="content">
              <p>Hello ${assigneeName},</p>
              <p>This is a reminder about an upcoming task:</p>
              <div class="task-box">
                <h3 style="margin-top: 0;">${taskTitle}</h3>
                <p>${taskDescription}</p>
                <p class="due-date">Due: ${dueDate}</p>
              </div>
              <p>Please log in to the practice management system to view and complete this task.</p>
            </div>
            <div class="footer">
              <p>The Perinatal Psychology Practice</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `Hello ${assigneeName},\n\nThis is a reminder about an upcoming task:\n\nTask: ${taskTitle}\nDescription: ${taskDescription}\nDue: ${dueDate}\n\nPlease log in to complete this task.\n\nThe Perinatal Psychology Practice`,
  };
}
