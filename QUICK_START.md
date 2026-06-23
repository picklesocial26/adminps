# Quick Start - Booking Confirmation

## 3 Things You Must Do Now

### 1. Update Supabase Database (5 minutes)
Add these columns to `bookings` table:

```sql
ALTER TABLE bookings 
ADD COLUMN messenger_id TEXT,
ADD COLUMN confirmed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN confirmed_by TEXT;
```

Or manually add 3 columns in table editor.

### 2. Redeploy to Vercel (2 minutes)

**Via Git:**
```bash
git add api/confirm-booking.js api/messenger-webhook.js
git commit -m "Add booking confirmation"
git push
```

**Or:** Vercel dashboard → Deployments → Click latest → Redeploy

### 3. Test It (5 minutes)

**Customer side:**
1. Send booking reference to bot: `PKL-ABCD123EFGH`
2. Bot responds with status

**Admin side:**
1. Open dashboard
2. Click "Confirm" on a booking
3. See success notification

**Check results:**
1. Customer received Messenger message
2. Database shows booking is "confirmed"

---

## The System Flow

```
Customer messages bot
    ↓
Messenger ID captured & stored
    ↓
Admin clicks "Confirm" in dashboard
    ↓
Automatic Messenger message sent
    with all booking details
```

## Files Changed

- ✅ `/api/confirm-booking.js` - NEW
- ✅ `/api/messenger-webhook.js` - UPDATED  
- ✅ `/js/admin-dashboard.js` - UPDATED

## Documentation

- **DEPLOYMENT_GUIDE.md** - How to deploy changes
- **BOOKING_SETUP.md** - Complete technical guide
- **BOOKING_CONFIRMATION_SETUP.md** - Detailed reference

---

## Common Issues

| Problem | Solution |
|---------|----------|
| 500 error on webhook | Redeploy to Vercel |
| Messenger notification not sent | Customer must message bot first |
| Database error | Add the 3 required columns |
| Reference not recognized | Use format like PKL-ABCD123EFGH |

---

**Questions?** Check BOOKING_SETUP.md for detailed documentation.
