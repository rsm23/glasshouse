var assert = require('assert');
var http = require('../server/lib/google-calendar-http');
var children = require('../server/lib/children');
children.setGaps(0, 0);
var calls = [];
http.init({ client: '/synthetic/curl', execFile: function (bin, args, options, cb) {
  var call = { bin: bin, args: args, options: options, config: '' }; calls.push(call);
  return { stdin: { on: function () {}, end: function (data) { call.config = data; cb(null, '{"items":[]}\n200'); } } };
} });
http.request('https://evil.example/calendar', {}, function (err) { assert.ok(err); });
http.request('https://www.googleapis.com.evil.example/calendar/v3/x', {}, function (err) { assert.ok(err); });
http.request('https://oauth2.googleapis.com/token', { form: { client_secret: 'private-secret', code: 'private-code' } }, function (err, result, status) {
  assert.ifError(err); assert.strictEqual(status, 200);
  assert.deepStrictEqual(calls[0].args, ['--disable', '--config', '-']);
  assert.strictEqual(JSON.stringify(calls[0].args).indexOf('private-'), -1);
  assert.ok(calls[0].config.indexOf('client_secret=private-secret') !== -1);
  assert.strictEqual(calls[0].config.indexOf('insecure'), -1, 'Google credentials require verified TLS');
  http.request('https://www.googleapis.com/calendar/v3/users/me/calendarList', { token: 'private-access' }, function (error) {
    assert.ifError(error);
    assert.ok(calls[1].config.indexOf('Authorization: Bearer private-access') !== -1);
    assert.strictEqual(JSON.stringify(calls[1].args).indexOf('private-access'), -1);
    console.log('test-google-calendar-http.js passed');
  });
});
