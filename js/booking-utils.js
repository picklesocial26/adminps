function isWeekend(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getDay();
  return day === 0 || day === 6;
}

function getBookingRateForDate(dateValue) {
  return isWeekend(dateValue) ? 450 : 400;
}

function normalizeBookingValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function findBookingConflicts(bookings, candidates) {
  const activeStatuses = new Set(['paid', 'confirmed']);
  const candidateIds = new Set((candidates || []).map(booking => booking.id));
  const candidateSlots = new Set((candidates || []).map(booking => [
    normalizeBookingValue(booking.booking_date),
    normalizeBookingValue(booking.court || booking.court_name),
    normalizeBookingValue(booking.time_slot || booking.booking_time)
  ].join('|')));

  return (bookings || []).filter(booking => {
    if (candidateIds.has(booking.id) || !activeStatuses.has(normalizeBookingValue(booking.status))) {
      return false;
    }

    const slot = [
      normalizeBookingValue(booking.booking_date),
      normalizeBookingValue(booking.court || booking.court_name),
      normalizeBookingValue(booking.time_slot || booking.booking_time)
    ].join('|');
    return candidateSlots.has(slot);
  });
}

if (typeof module !== 'undefined') {
  module.exports = { isWeekend, getBookingRateForDate, findBookingConflicts };
}
