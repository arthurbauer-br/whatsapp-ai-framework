# Meta WhatsApp Business API - Setup Guide

*[Leia em português](./META_API_SETUP_GUIDE.pt-BR.md)*

This guide walks through setting up the official Meta WhatsApp Business API for production use.

---

## Overview

**Timeline:** 1-3 weeks
**Difficulty:** Easy (technical) / Medium (bureaucratic)
**Who does what:**
- **Client:** Creates accounts, submits documents
- **You:** Technical setup, webhook configuration, testing

---

## Prerequisites (Client Needs)

Before starting, ensure the client has:

- [ ] **Business Registration** (SSM certificate for Malaysian companies)
- [ ] **Business Address Proof** (utility bill, bank statement, or business license)
- [ ] **Website OR Facebook Business Page** (must show business name)
- [ ] **Phone Number** (new number not currently registered on WhatsApp)
- [ ] **Email Access** to create/verify accounts

---

## Step-by-Step Setup

### Phase 1: Account Setup (Client does this, you guide)

#### Step 1.1: Create Meta Business Account

1. Go to [business.facebook.com](https://business.facebook.com)
2. Click "Create Account"
3. Enter:
   - Business name (must match SSM)
   - Your name
   - Business email
4. Verify email address

**Time:** 10 minutes

#### Step 1.2: Create Meta Developer Account

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Click "Get Started"
3. Accept terms
4. Verify phone number

**Time:** 5 minutes

#### Step 1.3: Create Meta App

1. In Meta Developer Dashboard, click "Create App"
2. Select "Business" as app type
3. Enter app name (e.g., "Company Name WhatsApp Bot")
4. Select the Business Account created in Step 1.1
5. Click "Create App"

**Time:** 5 minutes

#### Step 1.4: Add WhatsApp Product

1. In your app dashboard, find "Add Products"
2. Click "Set Up" on WhatsApp
3. Select your Business Account
4. Click "Continue"

**Time:** 2 minutes

---

### Phase 2: Business Verification (Client does this)

This is the longest step - Meta reviews business legitimacy.

#### Step 2.1: Start Verification

1. Go to [Business Settings](https://business.facebook.com/settings)
2. Click "Security Center" in left menu
3. Click "Start Verification"

#### Step 2.2: Submit Documents

Meta will ask for:

**Option A: Business Documents**
- Business registration certificate (SSM)
- Business license
- Tax registration

**Option B: Address Verification**
- Utility bill (within 3 months)
- Bank statement (within 3 months)
- Business registration showing address

**Upload Tips:**
- PDF or clear photos
- Documents must show business name
- Address must match what you entered
- All text must be legible

#### Step 2.3: Wait for Approval

- **Timeline:** 3-7 business days
- **Status check:** Security Center shows "Verified" when complete
- **If rejected:** Meta explains why, resubmit corrected documents

**Common Rejection Reasons:**
- Business name doesn't match documents exactly
- Documents are blurry or cut off
- Address doesn't match
- Website doesn't show business name

---

### Phase 3: Phone Number Setup (Together)

#### Step 3.1: Get a Phone Number

**Option A: Use Meta's Test Number (Free, for testing only)**
- Provided automatically in WhatsApp API setup
- Can only message numbers you add to "Test Numbers"
- Good for initial testing

**Option B: Add Your Own Number (Production)**
1. In WhatsApp API setup, click "Add Phone Number"
2. Enter the phone number (with country code)
3. Choose verification method (SMS or Voice call)
4. Enter verification code

**Important:**
- Number must NOT be currently registered on WhatsApp
- If it is, delete WhatsApp from that phone first
- After adding, number can ONLY be used via API (not WhatsApp app)

#### Step 3.2: Configure Phone Number

1. Set display name (business name shown to customers)
2. Set profile picture
3. Set business description

---

### Phase 4: Technical Setup (You do this)

#### Step 4.1: Get API Credentials

From Meta Developer Dashboard → Your App → WhatsApp → API Setup:

1. **Phone Number ID**
   - Listed under your added phone number
   - Example: `123456789012345`

2. **Access Token**
   - Click "Generate Token" (temporary, 24 hours)
   - Or create permanent token via System User (recommended for production)

3. **App Secret**
   - Found in App Settings → Basic
   - Used to verify webhook signatures

#### Step 4.2: Create Permanent Access Token (Recommended)

Temporary tokens expire in 24 hours. Create a permanent one:

1. Go to Business Settings → Users → System Users
2. Click "Add" to create a new system user
3. Name it (e.g., "WhatsApp Bot")
4. Set role to "Admin"
5. Click "Add Assets"
6. Select your App
7. Enable "Manage App"
8. Click "Generate Token"
9. Select permissions:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
10. Copy and save the token securely

#### Step 4.3: Configure Environment Variables

Update `.env` file:

```env
WHATSAPP_MODE=meta

META_PHONE_NUMBER_ID=123456789012345
META_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxx
META_WEBHOOK_VERIFY_TOKEN=your-random-secret-string
META_APP_SECRET=abcd1234567890
META_BUSINESS_ID=987654321098765
```

#### Step 4.4: Set Up Webhook

1. Make your server publicly accessible (ngrok for testing, real domain for production)

2. In Meta Developer Dashboard → WhatsApp → Configuration:
   - **Callback URL:** `https://your-domain.com/webhook/meta`
   - **Verify Token:** Same as `META_WEBHOOK_VERIFY_TOKEN` in .env

3. Subscribe to webhook fields:
   - `messages` (required - incoming messages)
   - `message_deliveries` (optional - delivery status)
   - `message_reads` (optional - read receipts)

4. Click "Verify and Save"

---

### Phase 5: Testing

#### Step 5.1: Test with Test Number

If using Meta's test number:
1. Add your phone to "Test Numbers" in API Setup
2. Send a WhatsApp message to the test number
3. Verify webhook receives it
4. Verify bot responds

#### Step 5.2: Test with Production Number

1. Send message from any WhatsApp to your business number
2. Verify webhook receives it
3. Verify bot responds
4. Check message appears in WhatsApp

#### Step 5.3: Verify Features

Test each feature:
- [ ] Text messages
- [ ] Images (if applicable)
- [ ] Quick reply buttons (if implemented)
- [ ] Template messages (if approved)

---

## Webhook Endpoint Setup

Add this to your Express server:

```javascript
const { MetaWhatsAppAPI, createWebhookMiddleware } = require('./src/whatsapp/meta-api');

// Initialize Meta API
const metaApi = new MetaWhatsAppAPI();
const webhook = createWebhookMiddleware(metaApi);

// Webhook verification (GET)
app.get('/webhook/meta', webhook.verify);

// Incoming messages (POST)
app.post('/webhook/meta', webhook.receive);

// Handle incoming messages (same as Baileys)
metaApi.on('messages.upsert', async ({ messages }) => {
    // Your existing message handling code works here!
});
```

---

## Message Templates (Optional)

For business-initiated messages (sending first), you need approved templates.

### Create a Template

1. Go to WhatsApp Manager → Message Templates
2. Click "Create Template"
3. Fill in:
   - Name (lowercase, underscores, e.g., `order_confirmation`)
   - Category (Marketing, Utility, Authentication)
   - Language
   - Content

### Template Example

```
Name: appointment_reminder
Category: Utility
Language: English

Header: Appointment Reminder
Body: Hi {{1}}, this is a reminder for your appointment on {{2}} at {{3}}.
Footer: Reply YES to confirm or NO to reschedule.
```

### Wait for Approval

- **Timeline:** Usually 24-48 hours
- **Status:** Shows in Message Templates list

### Using Templates in Code

```javascript
await metaApi.sendTemplateMessage(
    '60123456789',
    'appointment_reminder',
    'en',
    [
        { type: 'body', parameters: [
            { type: 'text', text: 'John' },
            { type: 'text', text: 'Dec 20' },
            { type: 'text', text: '3:00 PM' }
        ]}
    ]
);
```

---

## Pricing Guide

### Conversation-Based Pricing

Meta charges per 24-hour conversation window, not per message.

| Conversation Type | Description | ~MYR Cost |
|-------------------|-------------|-----------|
| User-initiated | Customer messages first | RM 0.15-0.25 |
| Business-initiated | You message first (template) | RM 0.30-0.45 |
| Marketing | Promotional templates | RM 0.50-0.70 |

### Free Tier

- **1,000 free user-initiated conversations per month**
- Good for small businesses

### Example Costs

| Monthly Volume | Estimated Cost |
|----------------|----------------|
| 500 conversations | Free (under free tier) |
| 2,000 conversations | ~RM 200-400 |
| 5,000 conversations | ~RM 500-1,000 |
| 10,000 conversations | ~RM 1,000-2,000 |

---

## Troubleshooting

### "Business Not Verified"

- Check Security Center for verification status
- Resubmit clearer documents
- Ensure business name matches exactly

### Webhook Not Receiving Messages

1. Check callback URL is accessible (test with curl)
2. Verify token matches exactly
3. Check webhook subscriptions are active
4. Review Meta's webhook logs in App Dashboard

### Messages Not Sending

1. Verify access token is valid
2. Check phone number is active
3. Ensure recipient has WhatsApp
4. Review error message from API

### Template Rejected

Common reasons:
- Contains prohibited content
- Missing variable placeholders
- Too promotional for utility category
- Grammar/spelling issues

---

## Checklist Summary

### Client Tasks
- [ ] Create Meta Business Account
- [ ] Create Meta Developer Account
- [ ] Complete Business Verification
- [ ] Provide phone number
- [ ] Verify phone number

### Your Tasks
- [ ] Create Meta App
- [ ] Add WhatsApp product
- [ ] Get API credentials
- [ ] Create permanent access token
- [ ] Configure webhook
- [ ] Update .env configuration
- [ ] Test messaging
- [ ] Create message templates (if needed)

---

## Support Resources

- [Meta Business Help Center](https://www.facebook.com/business/help)
- [WhatsApp Business API Documentation](https://developers.facebook.com/docs/whatsapp)
- [Meta Developer Support](https://developers.facebook.com/support)

---

*Document Version: 1.0*
*Last Updated: December 2024*
