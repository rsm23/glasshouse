var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var msg = require('./say').msg;
var transport = require('./google-calendar-http');
var request = transport.request;
var now = Date.now;
var file = '/var/lib/tvweb/google-calendar.json';
var credentials = {}, access = null, pending = null, generation = 0, refreshing = null;
var lastError = '';
var exchanging = false;
var SCOPES = ['https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly'];

function base64url(buffer) { return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function clean(value, max) { return typeof value === 'string' && value.length <= max && !/[\x00-\x20\x7f]/.test(value) ? value : ''; }
function fail() { return { ok: false, error: msg('srv.calendar.failed', 'Google Calendar is unavailable. Check the connection and try again.') }; }
function persist(next) {
  try {
    fs.writeFileSync(file + '.tmp', JSON.stringify(next), { mode: 384 });
    fs.chmodSync(file + '.tmp', 384);
    fs.renameSync(file + '.tmp', file);
    credentials = next;
    return true;
  } catch (e) { try { fs.unlinkSync(file + '.tmp'); } catch (ignored) {} return false; }
}
function status() {
  if (pending && pending.expires <= now()) { pending = null; lastError = 'expired'; }
  return { ok: true, connected: !!credentials.refreshToken, pending: !!pending || exchanging, errorCode: lastError };
}
function start(body, origin) {
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(origin) || +origin.split(':').pop() > 65535) return { ok: false,
    error: msg('srv.calendar.loopback', 'Open the dashboard at http://127.0.0.1 through an SSH tunnel before signing in to Google.') };
  var client = body && body.credentials && body.credentials.installed;
  if (!client || !/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(client.client_id || '') ||
      !clean(client.client_secret, 256)) return { ok: false,
    error: msg('srv.calendar.client', 'Choose a Google OAuth credential file for a Desktop app.') };
  var verifier = base64url(crypto.randomBytes(32)), state = base64url(crypto.randomBytes(32));
  generation++; access = null; lastError = ''; exchanging = false;
  pending = { clientId: client.client_id, clientSecret: client.client_secret, verifier: verifier,
    state: state, redirectUri: origin, expires: now() + 10 * 60000, generation: generation };
  var params = { client_id: client.client_id, redirect_uri: origin, response_type: 'code', scope: SCOPES.join(' '),
    state: state, code_challenge: base64url(crypto.createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent select_account' };
  return { ok: true, url: 'https://accounts.google.com/o/oauth2/v2/auth?' + Object.keys(params).map(function (key) {
    return key + '=' + encodeURIComponent(params[key]);
  }).join('&') };
}
function callback(query, origin, cb) {
  status();
  if (!pending || query.state !== pending.state || origin !== pending.redirectUri) return cb(false);
  var attempt = pending; pending = null;
  if (query.error || !clean(query.code, 4096)) { lastError = 'denied'; return cb(false); }
  exchanging = true;
  request('https://oauth2.googleapis.com/token', { form: { client_id: attempt.clientId, client_secret: attempt.clientSecret,
    code: query.code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, grant_type: 'authorization_code' } }, function (err, result, code) {
    if (attempt.generation !== generation) return cb(false);
    exchanging = false;
    if (err || code !== 200 || !result || !clean(result.access_token, 8192) || !clean(result.refresh_token, 8192) ||
        typeof result.scope !== 'string' || !SCOPES.every(function (scope) { return result.scope.split(' ').indexOf(scope) !== -1; })) {
      lastError = 'failed'; return cb(false);
    }
    if (!persist({ clientId: attempt.clientId, clientSecret: attempt.clientSecret, refreshToken: result.refresh_token })) {
      lastError = 'save'; return cb(false);
    }
    access = { token: result.access_token, expires: now() + Math.max(0, (+result.expires_in || 0) - 60) * 1000 };
    lastError = ''; cb(true);
  });
}
function token(cb) {
  if (!credentials.refreshToken) return cb(new Error('Not connected'));
  if (access && access.expires > now()) return cb(null, access.token);
  if (refreshing && refreshing.generation === generation) { refreshing.waiters.push(cb); return; }
  var task = { generation: generation, waiters: [cb] }; refreshing = task;
  request('https://oauth2.googleapis.com/token', { form: { client_id: credentials.clientId, client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken, grant_type: 'refresh_token' } }, function (err, result, code) {
    var valid = task.generation === generation && !err && code === 200 && result && clean(result.access_token, 8192);
    if (valid) { access = { token: result.access_token, expires: now() + Math.max(0, (+result.expires_in || 0) - 60) * 1000 }; lastError = ''; }
    if (task.generation === generation && !valid) {
      lastError = result && result.error === 'invalid_grant' ? 'revoked' : 'failed';
      if (lastError === 'revoked') { access = null; persist({}); generation++; }
    }
    if (refreshing === task) refreshing = null;
    task.waiters.forEach(function (done) { done(valid ? null : new Error('Google authorization failed'), valid ? access.token : null); });
  });
}
function api(url, cb) {
  var version = generation;
  token(function (err, bearer) {
    if (err || version !== generation) return cb(new Error('Google authorization failed'));
    request(url, { token: bearer }, function (error, result, code) {
      if (version !== generation) return cb(new Error('Connection changed'));
      if (code === 401) access = null;
      cb(error || code !== 200 ? new Error('Google Calendar request failed') : null, result);
    });
  });
}
function disconnect(cb) {
  var refreshToken = credentials.refreshToken;
  if (!persist({})) return cb(fail());
  generation++; access = null; pending = null; lastError = ''; exchanging = false;
  if (!refreshToken) return cb(status());
  request('https://oauth2.googleapis.com/revoke', { form: { token: refreshToken } }, function (err, result, code) {
    var reply = status(); reply.revoked = !err && code === 200; cb(reply);
  });
}
function init(opts) {
  opts = opts || {}; file = path.join(opts.stateDir || '/var/lib/tvweb', 'google-calendar.json');
  request = opts.googleRequest || transport.request; now = opts.now || Date.now;
  generation++; credentials = {}; access = null; pending = null; refreshing = null; lastError = ''; exchanging = false;
  try {
    var saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (clean(saved.clientId, 256) && clean(saved.clientSecret, 256) && clean(saved.refreshToken, 8192)) credentials = saved;
    fs.chmodSync(file, 384);
  } catch (e) {}
}
module.exports = { init: init, start: start, callback: callback, status: status, api: api, disconnect: disconnect, fail: fail,
  revision: function () { return generation; } };
