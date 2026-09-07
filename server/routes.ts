import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { generateEducationalVideo, cleanupOldVideos } from "./videoGenerator";
import * as path from "path";
import * as fs from "fs";
import express from "express";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

const SUPPORT_SYSTEM_PROMPT = `You are an AI Support Assistant for SimpleLecture LMS platform.

Your role:
- Help users with technical, account, payment, and platform-related issues.
- You must NOT answer academic, course subject, exam, or assignment questions.

Rules:
1. If a query is academic or course-related, politely redirect to the Forum
2. Provide clear, step-by-step solutions for support issues
3. Ask the user if the issue is resolved at the end of your response
4. If you are unsure, say so and indicate you'll escalate the ticket

You can help with:
- Login issues (password reset, access problems)
- Payment status (failed, pending, invoice)
- Course access issues
- App usage help
- Certificates, progress tracking
- General LMS navigation
- Technical issues

Important:
- Be concise and helpful
- Use bullet points for clarity
- Always end with: "Did this help resolve your issue?"
`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const videosDir = path.join(process.cwd(), 'public', 'videos');
  if (!fs.existsSync(videosDir)) {
    fs.mkdirSync(videosDir, { recursive: true });
  }
  app.use('/videos', express.static(videosDir));

  app.post('/api/generate-video', async (req, res) => {
    try {
      const { question, slides, audioBase64 } = req.body;

      if (!slides || !Array.isArray(slides) || slides.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Slides array is required',
        });
      }

      console.log(`Generating video for question: ${question}`);
      console.log(`Number of slides: ${slides.length}`);

      const result = await generateEducationalVideo({
        question,
        slides,
        audioBase64,
        outputFormat: 'mp4',
      });

      if (result.success) {
        res.json({
          success: true,
          videoUrl: result.videoUrl,
          duration: result.duration,
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error,
        });
      }
    } catch (error) {
      console.error('Video generation route error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  app.get('/api/video-status/:videoId', (req, res) => {
    const { videoId } = req.params;
    const videoPath = path.join(videosDir, `${videoId}.mp4`);
    
    if (fs.existsSync(videoPath)) {
      const stats = fs.statSync(videoPath);
      res.json({
        exists: true,
        size: stats.size,
        createdAt: stats.birthtime,
      });
    } else {
      res.json({ exists: false });
    }
  });

  app.post('/api/ai-support-chat', async (req, res) => {
    try {
      const { messages } = req.body as { messages: ChatMessage[] };

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'Messages array is required' });
      }

      const chatHistory = messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' as const : 'user' as const,
        parts: [{ text: m.content }],
      }));

      const contentsWithSystem = [
        { role: 'user' as const, parts: [{ text: SUPPORT_SYSTEM_PROMPT }] },
        { role: 'model' as const, parts: [{ text: 'I understand. I am the AI Support Assistant for SimpleLecture LMS. I will help with technical, account, payment, and platform issues only, and will politely redirect academic questions to the Forum. How can I assist you today?' }] },
        ...chatHistory,
      ];

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contentsWithSystem,
      });

      const responseText = response.text || '';
      
      res.json({ 
        success: true, 
        content: responseText 
      });
    } catch (error) {
      console.error('AI Support Chat error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get AI response' 
      });
    }
  });

  app.post('/api/send-notification', async (req, res) => {
    try {
      const apiKey = req.headers['x-api-key'];
      const serverKey = process.env.NOTIFICATION_API_KEY;
      if (serverKey && apiKey !== serverKey) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { pushToken, title, body, data } = req.body;

      if (!pushToken || !title || !body) {
        return res.status(400).json({
          success: false,
          error: 'pushToken, title, and body are required',
        });
      }

      const message = {
        to: pushToken,
        sound: 'default',
        title,
        body,
        data: data || {},
      };

      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      const result = await response.json();

      if (result.data?.status === 'error') {
        return res.status(400).json({
          success: false,
          error: result.data.message || 'Failed to send notification',
        });
      }

      res.json({ success: true, ticket: result.data });
    } catch (error) {
      console.error('Send notification error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send notification',
      });
    }
  });

  app.get('/privacy-policy', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Privacy Policy – Simple Lecture</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1f2937; background: #f9fafb; padding: 0; }
  header { background: linear-gradient(135deg, #2BBD6E 0%, #4ADE80 100%); color: #fff; padding: 40px 24px 32px; }
  header h1 { font-size: 28px; font-weight: 800; }
  header p { margin-top: 6px; opacity: 0.9; font-size: 15px; }
  .container { max-width: 820px; margin: 0 auto; padding: 32px 24px 80px; }
  .company-card { background: #fff; border-left: 4px solid #2BBD6E; border-radius: 10px; padding: 18px 20px; margin-bottom: 28px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .company-card strong { font-size: 15px; font-weight: 700; }
  .company-card p { color: #6b7280; font-size: 13px; margin-top: 4px; }
  .toc { background: #fff; border-radius: 10px; padding: 20px; margin-bottom: 28px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .toc h2 { font-size: 16px; font-weight: 700; margin-bottom: 14px; }
  .toc ol { padding-left: 20px; }
  .toc li { margin-bottom: 7px; }
  .toc a { color: #2BBD6E; text-decoration: none; font-size: 14px; }
  .toc a:hover { text-decoration: underline; }
  section { background: #fff; border-radius: 10px; padding: 24px 24px 20px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  section h2 { font-size: 17px; font-weight: 700; color: #111827; border-bottom: 1px solid #f3f4f6; padding-bottom: 12px; margin-bottom: 16px; display: flex; align-items: center; gap: 10px; }
  section h2 span.num { background: #2BBD6E; color: #fff; border-radius: 6px; padding: 2px 8px; font-size: 13px; }
  h3 { font-size: 14px; font-weight: 700; color: #374151; margin: 14px 0 8px; }
  p, li { font-size: 14px; line-height: 1.75; color: #4b5563; }
  ul { padding-left: 20px; margin-bottom: 8px; }
  li { margin-bottom: 5px; }
  .highlight { background: #f0fdf4; border-radius: 8px; padding: 12px 16px; font-size: 14px; color: #15803d; font-style: italic; margin-top: 10px; }
  .contact-row { display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
  .contact-row:last-child { border: none; }
  .contact-label { font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: .5px; }
  .contact-value { font-size: 14px; color: #111827; margin-top: 2px; }
  .contact-value a { color: #2BBD6E; text-decoration: none; }
  footer { text-align: center; padding: 24px; color: #9ca3af; font-size: 13px; }
</style>
</head>
<body>
<header>
  <h1>Privacy Policy</h1>
  <p>KRUPA KNOWLEDGE STORE PRIVATE LIMITED (OPC) &nbsp;|&nbsp; Operating as SimpleLecture</p>
  <p style="margin-top:10px; font-size:12px; opacity:.8;">Last Updated: February 6, 2025</p>
</header>

<div class="container">
  <div class="company-card">
    <strong>KRUPA KNOWLEDGE STORE PRIVATE LIMITED (OPC)</strong>
    <p>Operating as SimpleLecture &bull; Koramangala, Bangalore, Karnataka, India</p>
    <p style="margin-top:6px;">Contact: <a href="mailto:contact@simplelecture.com" style="color:#2BBD6E;">contact@simplelecture.com</a> &bull; +91 73530 21234</p>
  </div>

  <div class="toc">
    <h2>Table of Contents</h2>
    <ol>
      <li><a href="#s1">Information We Collect</a></li>
      <li><a href="#s2">How We Use Your Information</a></li>
      <li><a href="#s3">Information Sharing</a></li>
      <li><a href="#s4">Data Security</a></li>
      <li><a href="#s5">Cookies &amp; Tracking</a></li>
      <li><a href="#s6">Third-Party Services</a></li>
      <li><a href="#s7">Children's Privacy</a></li>
      <li><a href="#s8">Data Retention</a></li>
      <li><a href="#s9">Your Rights</a></li>
      <li><a href="#s10">Changes to Policy</a></li>
      <li><a href="#s11">Contact Information</a></li>
    </ol>
  </div>

  <section id="s1">
    <h2><span class="num">1</span> Information We Collect</h2>
    <h3>Information You Provide</h3>
    <ul>
      <li>Full name, email address, and phone number</li>
      <li>Password (stored in encrypted form)</li>
      <li>Profile picture</li>
      <li>Payment and billing information</li>
      <li>Course progress and quiz answers</li>
      <li>Forum posts and discussion contributions</li>
    </ul>
    <h3>Information Collected Automatically</h3>
    <ul>
      <li>Device information (model, OS version, unique device identifiers)</li>
      <li>Usage data (screens visited, features used, time spent)</li>
      <li>IP address and general location</li>
      <li>Cookies and similar tracking technologies</li>
      <li>Log data (crash reports, error logs, timestamps)</li>
    </ul>
  </section>

  <section id="s2">
    <h2><span class="num">2</span> How We Use Your Information</h2>
    <ul>
      <li>Provide, maintain, and improve our educational services</li>
      <li>Process transactions and send related information</li>
      <li>Personalize your learning experience and content recommendations</li>
      <li>Track your learning progress and generate performance insights</li>
      <li>Send notifications about courses, updates, and promotions</li>
      <li>Provide customer support and respond to your inquiries</li>
      <li>Detect, investigate, and prevent fraudulent or unauthorized activity</li>
      <li>Comply with legal obligations and enforce our policies</li>
      <li>Conduct analytics to understand how our platform is used</li>
    </ul>
  </section>

  <section id="s3">
    <h2><span class="num">3</span> Information Sharing</h2>
    <ul>
      <li><strong>Service providers</strong> — payment processors, hosting providers, analytics platforms acting on our behalf</li>
      <li><strong>Instructors</strong> — limited progress data to help them improve course delivery</li>
      <li><strong>Legal requirements</strong> — when required by law, court order, or governmental authority</li>
      <li><strong>Business transfers</strong> — in connection with a merger, acquisition, or sale of assets</li>
      <li><strong>With your consent</strong> — when you explicitly authorize us to share your information</li>
    </ul>
    <div class="highlight">We do not sell, rent, or trade your personal information to third parties for their marketing purposes.</div>
  </section>

  <section id="s4">
    <h2><span class="num">4</span> Data Security</h2>
    <ul>
      <li>Encryption of data in transit using TLS/SSL protocols</li>
      <li>Encryption of sensitive data at rest</li>
      <li>Secure authentication mechanisms including OTP and OAuth</li>
      <li>Regular security audits and vulnerability assessments</li>
      <li>Role-based access controls for internal staff</li>
      <li>Secure, certified data centers with physical security controls</li>
    </ul>
    <div class="highlight">While we implement industry-standard security measures, no method of transmission over the Internet or electronic storage is 100% secure. We cannot guarantee absolute security of your data.</div>
  </section>

  <section id="s5">
    <h2><span class="num">5</span> Cookies &amp; Tracking</h2>
    <ul>
      <li>Maintain your login session and authentication state</li>
      <li>Understand how you use our platform to improve your experience</li>
      <li>Personalize content and course recommendations</li>
      <li>Analytics to measure platform performance and usage patterns</li>
      <li>Serve relevant advertisements on third-party platforms</li>
    </ul>
    <p>You can control and manage cookies through your browser or device settings. Disabling certain cookies may limit some functionality of our platform.</p>
  </section>

  <section id="s6">
    <h2><span class="num">6</span> Third-Party Services</h2>
    <ul>
      <li>Razorpay and PhonePe — payment processing</li>
      <li>Google Analytics — usage analytics and insights</li>
      <li>Firebase — push notifications and crash reporting</li>
      <li>Cloud infrastructure providers — data hosting and storage</li>
      <li>Email and SMS service providers — communications and OTP delivery</li>
    </ul>
    <p style="margin-top:10px;">These third-party services have their own privacy policies. We are not responsible for the privacy practices of these services and encourage you to review their policies.</p>
  </section>

  <section id="s7">
    <h2><span class="num">7</span> Children's Privacy</h2>
    <ul>
      <li>Our platform is intended for users aged 13 and above</li>
      <li>Users under the age of 18 should obtain parental consent before using our services</li>
      <li>We do not knowingly collect personal information from children under 13</li>
    </ul>
    <p style="margin-top:10px;">If you believe that a child under 13 has provided us with personal information without appropriate consent, please contact us immediately at <a href="mailto:privacy@simplelecture.com">privacy@simplelecture.com</a> and we will take prompt steps to delete such information.</p>
  </section>

  <section id="s8">
    <h2><span class="num">8</span> Data Retention</h2>
    <p>We retain your personal information for as long as your account is active or as needed to provide you with our services. We also retain data as necessary to comply with legal obligations, resolve disputes, and enforce our agreements.</p>
    <p style="margin-top:10px;"><strong>Account Deletion:</strong> When you delete your account, we will delete or anonymize your personal information within a reasonable timeframe, except where retention is required by law or for legitimate business purposes.</p>
  </section>

  <section id="s9">
    <h2><span class="num">9</span> Your Rights</h2>
    <ul>
      <li><strong>Access</strong> — request a copy of the personal information we hold about you</li>
      <li><strong>Correction</strong> — request correction of inaccurate or incomplete data</li>
      <li><strong>Deletion</strong> — request deletion of your personal information</li>
      <li><strong>Portability</strong> — receive your data in a structured, machine-readable format</li>
      <li><strong>Opt-out</strong> — opt out of marketing communications at any time</li>
      <li><strong>Withdraw consent</strong> — withdraw consent for processing where consent is the legal basis</li>
    </ul>
    <p style="margin-top:10px;">To exercise any of these rights, please contact us at <a href="mailto:privacy@simplelecture.com">privacy@simplelecture.com</a>. We will respond to your request within 30 days.</p>
  </section>

  <section id="s10">
    <h2><span class="num">10</span> Changes to Policy</h2>
    <p>We may update this Privacy Policy from time to time to reflect changes in our practices, technologies, or legal requirements. The updated policy will be posted on this page with a revised "Last Updated" date.</p>
    <p style="margin-top:10px;">For significant changes that materially affect how we handle your personal information, we will notify you via email or through a prominent notice on our platform before the changes take effect.</p>
  </section>

  <section id="s11">
    <h2><span class="num">11</span> Contact Information</h2>
    <div class="contact-row">
      <div>
        <div class="contact-label">Data Protection Officer</div>
        <div class="contact-value"><a href="mailto:privacy@simplelecture.com">privacy@simplelecture.com</a></div>
      </div>
    </div>
    <div class="contact-row">
      <div>
        <div class="contact-label">General Enquiries</div>
        <div class="contact-value"><a href="mailto:contact@simplelecture.com">contact@simplelecture.com</a></div>
      </div>
    </div>
    <div class="contact-row">
      <div>
        <div class="contact-label">Phone</div>
        <div class="contact-value"><a href="tel:+917353021234">+91 73530 21234</a></div>
      </div>
    </div>
    <div class="contact-row">
      <div>
        <div class="contact-label">Registered Address</div>
        <div class="contact-value">Koramangala, Bangalore, Karnataka, India</div>
      </div>
    </div>
    <p style="margin-top:16px;"><a href="/terms-and-conditions" style="color:#2BBD6E;">View Terms &amp; Conditions →</a></p>
  </section>
</div>
<footer>© 2025 KRUPA KNOWLEDGE STORE PRIVATE LIMITED (OPC). All rights reserved.</footer>
</body>
</html>`);
  });

  setInterval(() => {
    cleanupOldVideos(24);
  }, 60 * 60 * 1000);

  return httpServer;
}
