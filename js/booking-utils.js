function isWeekend(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getDay();
  return day === 0 || day === 5 || day === 6;
}

function getBookingRateForDate(dateValue, timeSlot = '') {
  const date = new Date(dateValue);
  const startTime = String(timeSlot || '').split('-')[0].trim().toUpperCase();
  const timeMatch = startTime.match(/^(\d{1,2})(?::\d{2})?\s*(AM|PM)?$/);
  const startHour = timeMatch ? Number(timeMatch[1]) % 12 + (timeMatch[2] === 'PM' ? 12 : 0) : null;
  const isMondayEarlyMorning = !Number.isNaN(date.getTime()) && date.getDay() === 1 && startHour >= 1 && startHour < 5;
  return isWeekend(dateValue) || isMondayEarlyMorning ? 550 : 500;
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
