# Deployment Guide - Booking Confirmation Feature

## ⚠️ IMPORTANT: You must redeploy after code changes

The messenger-webhook and confirm-booking API files have been updated. Your Vercel deployment needs to be refreshed.

## How to Redeploy

### Option 1: Using Git (Recommended)
```bash
# In your project directory
git add api/confirm-booking.js api/messenger-webhook.js js/admin-dashboard.js
git commit -m "Add booking confirmation via Messenger"
git push
```

Vercel will automatically detect the push and redeploy. Wait 2-3 minutes for completion.

### Option 2: Manual Redeploy via Vercel Dashboard
1. Go to https://vercel.com/dashboard
2. Select your project
3. Click **"Deployments"** tab
4. Find the latest deployment
5. Click the **⋯** (three dots)
6. Select **"Redeploy"**

Wait for the deployment to complete (status changes to green).

### Option 3: Using Vercel CLI
```bash
# If you have Vercel CLI installed
vercel --prod
```

## What Changed

Files updated:
- `/api/confirm-booking.js` - NEW endpoint for confirming bookings
- `/api/messenger-webhook.js` - UPDATED to capture messenger IDs  
- `/js/admin-dashboard.js` - UPDATED confirmation messages

## Database Schema Changes

Add these columns to your `bookings` table in Supabase:

**SQL Method:**
```sql
ALTER TABLE bookings 
ADD COLUMN messenger_id TEXT,
ADD COLUMN confirmed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN confirmed_by TEXT;
```

**Or use Supabase Dashboard:**
1. Go to your Supabase project
2. Select `bookings` table
3. Click **"Add column"** button
4. Add each column:
   - Name: `messenger_id`, Type: `text`
   - Name: `confirmed_at`, Type: `timestamp with time zone`
   - Name: `confirmed_by`, Type: `text`

## Verify Deployment

1. Check your Vercel dashboard - deployment should show green status
2. Open your admin dashboard: `https://yourdomain.com/admin-dashboard.html`
3. Look for the "Confirm" button on bookings - should be visible

## Testing After Deployment

### Test the system:
1. **Send a booking reference to your Messenger bot**
   - Example: `PKL-ABCD123EFGH`
   - Bot should respond with booking status
   - Customer's messenger ID should now be stored

2. **Go to admin dashboard and click "Confirm"**
   - Should see a success toast message
   - Customer should receive Messenger notification with booking details

3. **Check Supabase**
   - Go to your `bookings` table
   - Verify `confirmed_at` and `confirmed_by` are populated

## Troubleshooting

### If you still get 500 error:
1. Check Vercel deployment logs:
   - Go to Vercel dashboard
   - Select project → Deployments → Click on failed deployment
   - Check "Functions" tab for error details

2. Clear browser cache: `Ctrl+Shift+Delete`

3. Verify environment variables are set:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `MESSENGER_PAGE_ACCESS_TOKEN`
   - `MESSENGER_VERIFY_TOKEN`

### If Messenger notification doesn't send:
1. Verify customer has messaged the bot (to establish messenger ID)
2. Check Supabase - `messenger_id` should be populated
3. Ensure environment variables are correct

## Need Help?

Check the following files for detailed documentation:
- `BOOKING_CONFIRMATION_SETUP.md` - System overview and API docs
- This file - Deployment instructions

---

**After deployment is complete, test it with your bot!** ✅
