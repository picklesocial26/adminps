// ManyChat booking confirmation endpoint alias
// This route uses the same booking confirmation logic as /api/confirm-booking
// and is provided for ManyChat automation flows.

const handler = require('./confirm-booking');

module.exports = handler;
module.exports.default = handler;
module.exports.handler = handler;
