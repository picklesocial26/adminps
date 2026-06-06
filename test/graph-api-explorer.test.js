// Tests for Graph API Explorer related webhook behavior

// Set env vars before requiring the module so constants are initialized correctly
process.env.MESSENGER_VERIFY_TOKEN = 'test-verify-token';
process.env.MESSENGER_PAGE_ACCESS_TOKEN = 'test-page-token';

const webhook = require('../api/messenger-webhook');

function makeRes() {
  let statusCode = null;
  let body = null;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    send(b) {
      body = b;
      this._sent = true;
      return this;
    },
    end() {
      this._ended = true;
      return this;
    },
    json(obj) {
      body = obj;
      return this;
    },
    setHeader() {},
    _getStatus() { return statusCode; },
    _getBody() { return body; }
  };
}

describe('Messenger webhook verification', () => {
  test('should verify webhook with correct token', () => {
    const req = {
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'test-verify-token',
        'hub.challenge': 'CHALLENGE_CODE'
      }
    };

    const res = makeRes();

    webhook.handleVerification(req, res);

    expect(res._getStatus()).toBe(200);
    expect(res._getBody()).toBe('CHALLENGE_CODE');
  });

  test('should reject verification with wrong token', () => {
    const req = {
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'CHALLENGE'
      }
    };

    const res = makeRes();

    webhook.handleVerification(req, res);

    expect(res._getStatus()).toBe(403);
  });
});

describe('Handle events and messaging flow', () => {
  test('should process a simple message and call sendMessage', async () => {
    // Replace sendMessage with a spy via setter
    const sendSpy = jest.fn().mockResolvedValue(true);
    if (typeof webhook.setSendMessage === 'function') webhook.setSendMessage(sendSpy);

    const req = {
      body: {
        object: 'page',
        entry: [
          {
            messaging: [
              { sender: { id: 'USER123' }, message: { text: 'HELP' } }
            ]
          }
        ]
      }
    };

    const res = makeRes();

    await webhook.handleEvents(req, res);

    expect(res._getStatus()).toBe(200);
    expect(res._getBody()).toBe('ok');
    expect(sendSpy).toHaveBeenCalled();
  });
});

describe('formatBookingMessage', () => {
  test('returns not found for null booking', () => {
    const out = webhook.formatBookingMessage(null);
    expect(out.text).toMatch(/Booking not found/i);
  });

  test('formats confirmed booking', () => {
    const booking = {
      reference_code: 'PKL-12345',
      customer_name: 'Alice',
      booking_date: '2026-06-10',
      time_slot: '10:00',
      court: 'Court 1',
      status: 'confirmed'
    };

    const out = webhook.formatBookingMessage(booking);
    expect(out.text).toMatch(/Confirmed/i);
    expect(out.text).toMatch(/PKL-12345/);
    expect(out.text).toMatch(/Alice/);
  });
});
