var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var calendar = require('../server/lib/home-calendar');
var auth = calendar.auth;
var widgets = require('../server/lib/home-widgets');
var placement = require('../server/assets/widget-layout');
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glasshouse-calendar-'));
var jobs = [], time = Date.UTC(2026, 10, 13, 10), result;
var origin = 'http://127.0.0.1:18080';
var client = { installed: { client_id: '123.example.apps.googleusercontent.com', client_secret: 'test-secret' } };
function init() {
  jobs = [];
  calendar.init({ stateDir: dir, now: function () { return time; }, googleRequest: function (url, options, cb) { jobs.push({ url: url, options: options, reply: cb }); } });
}
var scopes = ['https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly'];
function tokens() { return { access_token: 'test-access', refresh_token: 'test-refresh', scope: scopes.join(' '), expires_in: 3600 }; }
function start() { return new URL(auth.start({ credentials: client }, origin).url); }
function signIn() {
  var url = start();
  auth.callback({ state: url.searchParams.get('state'), code: 'test-code' }, origin, function (ok) { result = ok; });
  jobs[jobs.length - 1].reply(null, tokens(), 200);
  assert.strictEqual(result, true);
}
function read(settings) { calendar.read(settings, function (value) { result = value; }); return result; }
function item(id, from, to) { return { id: id, summary: id, start: { dateTime: from }, end: { dateTime: to } }; }
try {
  init();
  assert.strictEqual(auth.status().connected, false);
  assert.strictEqual(auth.start({ credentials: client }, 'http://192.168.1.1:8080').ok, false, 'callbacks must terminate on the computer loopback');
  assert.strictEqual(auth.start({ credentials: { web: client.installed } }, origin).ok, false);
  var url = start(), state = url.searchParams.get('state');
  assert.deepStrictEqual(url.searchParams.get('scope').split(' ').sort(), scopes.slice().sort());
  assert.strictEqual(url.searchParams.get('code_challenge_method'), 'S256');
  assert.strictEqual(url.searchParams.get('access_type'), 'offline');
  auth.callback({ state: 'wrong', code: 'test-code' }, origin, function (ok) { assert.strictEqual(ok, false); });
  auth.callback({ state: state, code: 'test-code' }, 'http://127.0.0.1:9999', function (ok) { assert.strictEqual(ok, false); });
  assert.strictEqual(jobs.length, 0);
  auth.callback({ state: state, code: 'test-code' }, origin, function (ok) { result = ok; });
  assert.strictEqual(auth.status().pending, true, 'token exchange stays pending until its response');
  var verifier = jobs[0].options.form.code_verifier;
  assert.strictEqual(crypto.createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), url.searchParams.get('code_challenge'));
  jobs[0].reply(null, tokens(), 200);
  assert.strictEqual(result, true);
  assert.strictEqual(fs.statSync(path.join(dir, 'google-calendar.json')).mode & 511, 384);
  assert.strictEqual(JSON.stringify(auth.status()).indexOf('test-refresh'), -1);
  auth.callback({ state: state, code: 'test-code' }, origin, function (ok) { assert.strictEqual(ok, false, 'authorization callbacks are single use'); });
  assert.strictEqual(jobs.length, 1);

  init();
  calendar.calendars(function (value) { result = value; });
  assert.strictEqual(jobs[0].options.form.grant_type, 'refresh_token', 'a restart restores the private refresh token');
  jobs[0].reply(null, tokens(), 200);
  assert.ok(jobs[1].url.indexOf('minAccessRole=reader') !== -1);
  jobs[1].reply(null, { items: [{ id: 'one@example.com', summary: 'Personal', primary: true }], nextPageToken: 'second' }, 200);
  assert.ok(jobs[2].url.indexOf('pageToken=second') !== -1);
  jobs[2].reply(null, { items: [{ id: 'two', summary: 'Family' }] }, 200);
  assert.deepStrictEqual(result.calendars.map(function (value) { return value.name; }), ['Personal', 'Family']);
  var settings = calendar.normalise({ enabled: true, calendars: result.calendars });
  var first = jobs.length;
  assert.strictEqual(read(settings).loading, true, 'slow provider reads return immediately');
  assert.strictEqual(read(settings).loading, true);
  assert.strictEqual(jobs.length, first + 1, 'in-flight event reads are shared');
  assert.ok(jobs[first].url.indexOf('singleEvents=true&orderBy=startTime') !== -1, 'Google expands recurrence and orders instances');
  assert.ok(jobs[first].url.indexOf('one%40example.com') !== -1);
  jobs[first].reply(null, { items: [
    item('late', '2026-11-15T15:00:00+01:00', '2026-11-15T16:00:00+01:00'),
    { id: 'all-day', summary: 'Holiday', start: { date: '2026-11-14' }, end: { date: '2026-11-15' } },
    { id: 'cancelled', status: 'cancelled', start: { date: '2026-11-14' }, end: { date: '2026-11-15' } },
    { id: 'declined', attendees: [{ self: true, responseStatus: 'declined' }], start: { date: '2026-11-14' }, end: { date: '2026-11-15' } },
    item('past', '2026-11-12T10:00:00Z', '2026-11-12T11:00:00Z')
  ] }, 200);
  assert.strictEqual(read(settings).events.length, 2);
  jobs[first + 1].reply(null, { items: [item('early', '2026-11-13T14:00:00Z', '2026-11-13T15:00:00Z')] }, 200);
  var final = read(settings);
  assert.strictEqual(final.loading, undefined);
  assert.deepStrictEqual(final.events.map(function (value) { return value.id; }), ['early', 'all-day', 'late']);
  assert.strictEqual(final.events[1].start, '2026-11-14', 'all-day dates remain date-only');
  var earlyLocal = calendar.event(item('after-midnight', new Date(2026, 10, 14, 0, 30).toISOString(), new Date(2026, 10, 14, 1, 30).toISOString()), settings.calendars[0], time);
  assert.ok(final.events[1].sort < earlyLocal.sort, 'all-day events sort at local midnight, before early local appointments');
  assert.strictEqual(jobs.length, first + 2, 'cached reads do not reach Google');
  time += 5 * 60000;
  read(settings);
  jobs[first + 2].reply(new Error('offline'));
  jobs[first + 3].reply(null, { items: [] }, 200);
  assert.strictEqual(read(settings).partial, true);
  assert.deepStrictEqual(read(settings).events, [], 'failed reads do not retain old event titles');
  assert.strictEqual(read({ enabled: false, calendars: settings.calendars }).available, false);

  var migrated = widgets.normalise({ custom: [{ version: 1, type: 'text', id: 'calendar', name: 'Saved note', value: 'Keep' }], order: ['calendar'], positions: { calendar: 'left' } });
  assert.strictEqual(migrated.custom[0].id, 'calendar-custom');
  assert.strictEqual(migrated.positions['calendar-custom'], 'left');
  assert.strictEqual(migrated.order[0], 'calendar-custom');
  var normal = widgets.normalise({ calendar: { enabled: true, calendars: settings.calendars } });
  assert.strictEqual(widgets.count(normal, false), 1);
  assert.deepStrictEqual(placement.active({ widgets: normal, showClock: false }), ['calendar']);

  init(); signIn();
  auth.disconnect(function (value) { result = value; });
  assert.strictEqual(auth.status().connected, false, 'disconnect removes local authorization before revocation');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'google-calendar.json'), 'utf8')), {});
  jobs[jobs.length - 1].reply(new Error('offline'));
  assert.strictEqual(result.revoked, false, 'failed remote revocation is visible');

  init(); url = start(); time += 11 * 60000;
  auth.callback({ state: url.searchParams.get('state'), code: 'late' }, origin, function (ok) { assert.strictEqual(ok, false); });
  assert.strictEqual(jobs.length, 0, 'expired attempts cannot exchange codes');
  signIn(); init();
  calendar.calendars(function (value) { result = value; });
  var refresh = jobs[0];
  auth.disconnect(function () {});
  refresh.reply(null, tokens(), 200);
  assert.strictEqual(auth.status().connected, false, 'a late refresh cannot resurrect a disconnected account');
  assert.strictEqual(result.ok, false);
  jobs[1].reply(null, {}, 200);
  init(); signIn(); init();
  calendar.calendars(function (value) { result = value; });
  jobs[0].reply(null, { error: 'invalid_grant' }, 400);
  assert.strictEqual(auth.status().connected, false, 'revoked Google grants require signing in again');
  scopes.forEach(function (scope) {
    init(); url = start();
    auth.callback({ state: url.searchParams.get('state'), code: 'partial' }, origin, function (ok) { result = ok; });
    var partial = tokens(); partial.scope = scope;
    jobs[0].reply(null, partial, 200);
    assert.strictEqual(result, false, 'consent must cover both calendar selection and event reads');
    assert.strictEqual(auth.status().connected, false, 'partial consent does not save an unusable connection');
  });
  console.log('test-home-calendar.js passed');
} finally {
  fs.readdirSync(dir).forEach(function (name) { fs.unlinkSync(path.join(dir, name)); });
  fs.rmdirSync(dir);
}
