var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var routes = require('../server/lib/routes');
var calls = [], config = { allowControl: true, token: 'dashboard-key', web: { enabled: false } };
var calendar = {
  read: function (settings, cb) { calls.push('read'); cb({ ok: true, available: true, events: [] }); },
  calendars: function (cb) { calls.push('calendars'); cb({ ok: true, calendars: [] }); },
  auth: {
    status: function () { return { ok: true, connected: false }; },
    start: function (body, origin) { calls.push(['connect', body, origin]); return { ok: true }; },
    disconnect: function (cb) { calls.push('disconnect'); cb({ ok: true }); },
    callback: function (query, origin, cb) { calls.push(['callback', query.state, origin]); cb(true); }
  }
};
routes.init({ config: config, home: { widgets: { calendar: calendar }, layout: function () { return { widgets: { calendar: {} } }; } } });
function request(url, method, headers, body) {
  var req = new EventEmitter(), response = { code: null, headers: {}, body: '' };
  req.url = url; req.method = method || 'GET';
  req.headers = headers || {}; req.connection = { remoteAddress: '192.0.2.1' }; req.setEncoding = function () {}; req.destroy = function () {};
  routes.handleRequest(req, { writeHead: function (code, value) { response.code = code; response.headers = value; }, end: function (value) { response.body = value || ''; } });
  if (method === 'POST') { req.emit('data', JSON.stringify(body || {})); req.emit('end'); }
  return response;
}
var base = '/api/home/widgets/calendar';
assert.strictEqual(request(base).code, 401, 'event details require dashboard authentication');
assert.strictEqual(request(base + '/status').code, 401);
assert.strictEqual(request(base + '/calendars', 'POST', { 'content-type': 'application/json' }).code, 401);
assert.strictEqual(calls.length, 0);
var headers = { authorization: 'Bearer dashboard-key', host: '127.0.0.1:18080', 'content-type': 'application/json' };
assert.strictEqual(request(base, 'GET', headers).code, 200);
assert.strictEqual(request(base + '/status', 'GET', headers).code, 200);
assert.strictEqual(request(base + '/connect', 'POST', headers, { credentials: 'synthetic' }).code, 200);
assert.deepStrictEqual(calls[1], ['connect', { credentials: 'synthetic' }, 'http://127.0.0.1:18080']);
assert.strictEqual(request(base + '/calendars', 'POST', headers).code, 200);
assert.strictEqual(request(base + '/disconnect', 'POST', headers).code, 200);
var before = calls.length;
assert.strictEqual(request(base + '/connect', 'POST', { authorization: 'Bearer dashboard-key', 'content-type': 'text/plain' }).code, 415);
assert.strictEqual(request(base + '/disconnect', 'POST', { authorization: 'Bearer dashboard-key', 'content-type': 'application/json', host: '127.0.0.1:18080', origin: 'https://evil.example' }).code, 403);
config.allowControl = false;
assert.strictEqual(request(base + '/disconnect', 'POST', headers).code, 403);
assert.strictEqual(calls.length, before, 'refused requests never reach calendar controls');
var callback = request('/?state=one-use-state&code=private-code', 'GET', { host: '127.0.0.1:18080' });
assert.strictEqual(callback.code, 303, 'OAuth callback uses its own state rather than the dashboard key');
assert.strictEqual(callback.headers.Location, '/#home');
assert.strictEqual(callback.headers['Cache-Control'], 'no-store');
assert.strictEqual(callback.headers['Referrer-Policy'], 'no-referrer');
assert.strictEqual(callback.body.indexOf('private-code'), -1);
console.log('test-calendar-routes.js passed');
