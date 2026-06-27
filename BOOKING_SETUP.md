# Booking Confirmation Setup Guide

## Overview

This system automatically sends booking confirmation details to customers via Messenger when admins click "Confirm" in the dashboard.

**Flow:**
1. Customer messages the bot with booking reference (e.g., `PKL-ABCD123EFGH`)
2. System stores the customer's Messenger ID
3. Admin clicks "Confirm" button on the booking
4. Automatic Messenger notification is sent with full booking details

## System Architecture

```
Customer sends Messenger
     ↓
Webhook receives message
     ↓
Messenger ID is stored in database
     ↓
Admin clicks "Confirm" in dashboard
     ↓
API endpoint triggers
     ↓
Booking status → "confirmed"
     ↓
Messenger notification sent with details
```

## Required Database Columns

Add these to your `bookings` table:

```sql
ALTER TABLE bookings 
ADD COLUMN messenger_id TEXT,
ADD COLUMN confirmed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN confirmed_by TEXT;
```

**Column Details:**
- `messenger_id` (text) - Customer's Facebook Messenger ID (stored when they first message bot)
- `confirmed_at` (timestamp) - When booking was confirmed
- `confirmed_by` (text) - Who confirmed it (usually "admin")

## API Endpoints

### POST `/api/confirm-booking`

Confirms a booking and sends Messenger notification.

**Request:**
```json
{
  "reference_code": "PKL-ABCD123EFGH"
}
```

**Response - Success:**
```json
{
  "success": true,
  "reference_code": "PKL-ABCD123EFGH",
  "customer_name": "John Doe",
  "messenger_notification_sent": true,
  "message": "Booking confirmed! Customer notified via Messenger."
}
```

**Response - No Messenger ID:**
```json
{
  "success": true,
  "reference_code": "PKL-ABCD123EFGH",
  "customer_name": "John Doe",
  "messenger_notification_sent": false,
  "message": "Booking confirmed. Customer can check status anytime by messaging us."
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Booking not found",
  "reference_code": "PKL-ABCD123EFGH"
}
```

## Supported Booking Reference Formats

The system recognizes:
- `PKL-ABCD123EFGH` ✅
- `REF-ABC123` ✅  
- `ABC123DEF` ✅
- `REF123456` ✅

**Requirements:**
- Alphanumeric characters
- At least 6 characters
- Can include dashes/hyphens

## Message Format

When customer is confirmed, they receive:

```
📅 *Booking Confirmed!*

*Reference:* PKL-ABCD123EFGH
*Customer:* John Doe
*Phone:* +63-9XX-XXX-XXXX

*Booking Details:*
🎾 *Court:* Court One
📆 *Date:* 2026-06-15
⏰ *Time:* 10:00 AM
💰 *Amount:* ₱500.00

*Status:* ✅ CONFIRMED

📝 *Notes:* Special request text (if any)

Thank you for booking with Pickle Social! 🎾
See you soon!
```

## Environment Variables Required

Make sure your Vercel/hosting platform has:

```
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_KEY=your_service_role_key
MESSENGER_PAGE_ACCESS_TOKEN=your_page_access_token
MESSENGER_VERIFY_TOKEN=your_verify_token
```

Get these from:
- **Supabase:** Project Settings → API
- **Facebook:** Messenger App → Settings → Tokens & Webhooks

## Testing Checklist

### Step 1: Test Message Capture
- [ ] Send booking reference to bot: `PKL-ABCD123EFGH`
- [ ] Bot responds with booking status
- [ ] Check Supabase - `messenger_id` should be populated

### Step 2: Test Confirmation
- [ ] Open admin dashboard
- [ ] Find the booking with populated `messenger_id`
- [ ] Click "Confirm" button
- [ ] See success toast: "✅ Booking confirmed!"

### Step 3: Verify Message Received
- [ ] Customer receives Messenger notification
- [ ] Message includes all booking details
- [ ] Status shows "✅ CONFIRMED"

### Step 4: Check Database
- [ ] `status` field is "confirmed"
- [ ] `confirmed_at` has timestamp
- [ ] `confirmed_by` shows "admin"

## Troubleshooting

### "Booking not found" error
**Cause:** Reference code doesn't match database  
**Fix:** 
- Verify exact spelling (case-sensitive)
- Ensure booking exists in Supabase

### Messenger notification not sent
**Cause 1:** Customer hasn't messaged bot yet  
**Fix:** Ask customer to message bot with reference

**Cause 2:** `messenger_id` column missing  
**Fix:** Add the column to Supabase (see database section)

**Cause 3:** Environment variables not set  
**Fix:** Add tokens to your hosting platform settings

### Bot not recognizing reference
**Cause:** Reference format not supported  
**Fix:** Ensure reference is alphanumeric, 6+ characters, no special chars except dashes

### 500 error on API
**Cause:** Supabase connection issue or missing environment variables  
**Fix:**
- Verify environment variables are set
- Check Supabase URL and key are correct
- Check Vercel deployment logs

## File Structure

```
admin/
├── api/
│   ├── confirm-booking.js       ← Confirmation endpoint
│   ├── messenger-webhook.js     ← Webhook (captures messenger IDs)
│   ├── notify-customer.js       ← General notifications
│   └── send-custom-message.js   ← Custom messages
├── js/
│   ├── admin-dashboard.js       ← Dashboard JS
│   ├── app.js
│   └── messenger-integration.js
├── admin-dashboard.html
├── index.html
└── DEPLOYMENT_GUIDE.md
```

## How It Works - Detailed

### When Customer Messages Bot:

1. **Webhook Receives Message**
   - Customer sends: "PKL-ABCD123EFGH"
   - Webhook endpoint gets the message

2. **System Processes Request**
   - Extracts reference code
   - Queries Supabase for matching booking
   - Returns booking status to customer

3. **Messenger ID Stored**
   - System updates `bookings.messenger_id` 
   - Now linked to customer's Messenger ID

### When Admin Clicks Confirm:

1. **Dashboard Sends Request**
   - POST to `/api/confirm-booking`
   - Body: `{ reference_code: "PKL-ABCD123EFGH" }`

2. **Server Processes**
   - Looks up booking in Supabase
   - Updates `status` to "confirmed"
   - Sets `confirmed_at` timestamp
   - Sets `confirmed_by` to "admin"

3. **Notification Sent**
   - If `messenger_id` exists, sends detailed message
   - Otherwise, returns success but no message sent

4. **Dashboard Updates**
   - Shows success notification
   - Reloads bookings table
   - Status now shows "confirmed"

## Security Notes

✅ **Protected:**
- Only admins with dashboard access can confirm
- API calls over HTTPS in production
- Messenger IDs stored in secure database

⚠️ **Best Practices:**
- Keep API keys in environment variables (never in code)
- Use webhook tokens for verification
- Monitor for unusual activity in database

## Future Enhancements

Possible additions:
- Email confirmations in addition to Messenger
- SMS notifications
- Scheduled confirmations
- Bulk confirmations
- Reminders before booking date
- Customer-initiated confirmations via Messenger

---

For deployment instructions, see `DEPLOYMENT_GUIDE.md`
