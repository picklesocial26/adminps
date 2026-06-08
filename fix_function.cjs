const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'js', 'admin-dashboard.js');
let content = fs.readFileSync(filePath, 'utf8');

// Find the function boundaries
const start = content.indexOf('function copyBookingDetailsConfirmation()');
const end = content.indexOf('function previousPage()', start);

if (start > -1 && end > -1) {
  const newFunc = `function copyBookingDetailsConfirmation() {
  const group = currentBookingDetailsGroup;
  if (!group) {
    showToast('No booking details available to copy');
    return;
  }

  const customerName = group.customer_name || 'N/A';
  const bookingReference = group.reference_code || 'N/A';
  const totalPaid = \`₱\${(group.totalAmount || 0).toLocaleString()}\`;
  const dates = Array.from(group.dates || new Set());
  const formattedDates = dates.length
    ? dates.map(d => {
        const parsed = new Date(d);
        if (isNaN(parsed)) return d;
        return parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      }).join(', ')
    : 'N/A';

  const courtGroups = (group.bookings || []).reduce((acc, booking) => {
    const courtName = booking.court || booking.court_name || 'N/A';
    const timeSlot = booking.time_slot || booking.booking_time || 'N/A';
    if (!acc[courtName]) acc[courtName] = [];
    if (!acc[courtName].includes(timeSlot)) acc[courtName].push(timeSlot);
    return acc;
  }, {});

  const sortTime = (timeStr) => {
    const match = timeStr.match(/(\\d+):(\\d+)\\s(AM|PM)/);
    if (!match) return 0;
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const meridiem = match[3];
    if (meridiem === 'PM' && hours !== 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  };

  Object.keys(courtGroups).forEach(court => {
    courtGroups[court].sort((a, b) => sortTime(a) - sortTime(b));
  });

  const timeEmojis = ['🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛', '🕐', '🕑'];
  let emojiIndex = 0;
  const bookingLines = Object.entries(courtGroups).map(([courtName, times]) => {
    const timesList = times.map(timeSlot => {
      const emoji = timeEmojis[emojiIndex % timeEmojis.length];
      emojiIndex++;
      return \`\${emoji} \${timeSlot}\`;
    }).join('\\n');
    return \`🏸 \${courtName}\\n\${timesList}\`;
  }).join('\\n\\n');

  const message = \`BOOKING CONFIRMATION\\n\\nHello \${customerName},\\n\\nThank you for booking with Pickle Social - Cebu! Your reservation has been successfully confirmed. ✅\\n\\n📌 Booking Reference: \${bookingReference}\\n💳 Total Paid: \${totalPaid}\\n📅 Date: \${formattedDates}\\n\\n\${bookingLines}\\n\\nThank you for booking with us! Your reservation has been successfully confirmed.\`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(message).then(() => {
      showToast('Booking confirmation copied');
    }).catch(() => {
      prompt('Copy the text below for Messenger:', message);
    });
  } else {
    prompt('Copy the text below for Messenger:', message);
  }
}`;

  const newContent = content.substring(0, start) + newFunc + content.substring(end);
  fs.writeFileSync(filePath, newContent, 'utf8');
  console.log('✅ Function fixed with proper emojis and time sorting!');
} else {
  console.log('❌ Could not find function boundaries');
  console.log('Start:', start, 'End:', end);
}
