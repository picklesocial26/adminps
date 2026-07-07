function isWeekend(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  const day = date.getDay();
  return day === 0 || day === 6;
}

function getBookingRateForDate(dateValue) {
  return isWeekend(dateValue) ? 450 : 400;
}

if (typeof module !== 'undefined') {
  module.exports = { isWeekend, getBookingRateForDate };
}
