var auth = require('./google-calendar-auth');
var text = require('./home-widget-format').text;
var now = Date.now, cache = null, inFlight = null;
var API = 'https://www.googleapis.com/calendar/v3/';

function normalise(raw) {
  raw = raw || {};
  var ids = [], calendars = [];
  if (Array.isArray(raw.calendars)) raw.calendars.slice(0, 8).forEach(function (item) {
    var id = item && text(item.id, 512), name = item && text(item.name, 100);
    if (id && name && ids.indexOf(id) === -1) { ids.push(id); calendars.push({ id: id, name: name }); }
  });
  return { enabled: raw.enabled === true, calendars: calendars };
}
function calendars(cb) {
  var items = [], pages = 0, version = auth.revision();
  function read(page) {
    auth.api(API + 'users/me/calendarList?minAccessRole=reader&maxResults=250' + (page ? '&pageToken=' + encodeURIComponent(page) : ''), function (err, result) {
      if (err || version !== auth.revision() || !result || !Array.isArray(result.items)) return cb(auth.fail());
      result.items.forEach(function (item) {
        if (item && !item.deleted && typeof item.id === 'string') items.push({ id: text(item.id, 512), name: text(item.summaryOverride || item.summary || item.id, 100), primary: item.primary === true });
      });
      if (result.nextPageToken && ++pages < 8) return read(result.nextPageToken);
      cb({ ok: true, calendars: items });
    });
  }
  read('');
}
function midnight(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  var parts = value.split('-');
  return new Date(+parts[0], +parts[1] - 1, +parts[2]).getTime();
}
function event(item, calendar, at) {
  if (!item || item.status === 'cancelled' || !item.start || !item.end) return null;
  if (Array.isArray(item.attendees) && item.attendees.some(function (a) { return a && a.self && a.responseStatus === 'declined'; })) return null;
  var allDay = typeof item.start.date === 'string', start = allDay ? item.start.date : item.start.dateTime, end = allDay ? item.end.date : item.end.dateTime;
  var from = allDay ? midnight(start) : Date.parse(start), to = allDay ? midnight(end) : Date.parse(end);
  if (!isFinite(from) || !isFinite(to) || to <= from || !allDay && to <= at) return null;
  return { id: text(item.id, 256), title: text(item.summary, 160), start: start, end: end, allDay: allDay,
    location: text(item.location, 160), calendar: calendar.name, sort: from };
}
function read(raw, cb) {
  var settings = normalise(raw), version = auth.revision(), at = now(), key = JSON.stringify([version, settings.calendars]);
  if (!settings.enabled || !settings.calendars.length || !auth.status().connected) return cb({ ok: true, available: false, events: [] });
  if (cache && cache.key === key && at - cache.updated < (cache.data.available ? 5 : 1) * 60000) return cb(cache.data);
  if (inFlight && inFlight.key === key) return cb(inFlight.progress);
  var task = { key: key, progress: { ok: true, available: false, loading: true, events: [] } }; inFlight = task;
  cb(task.progress);
  var events = [], failed = 0, index = 0;
  function next() {
    if (version !== auth.revision()) return finish({ ok: true, available: false, events: [] });
    if (index >= settings.calendars.length) {
      events.sort(function (a, b) { return a.sort - b.sort || a.title.localeCompare(b.title); });
      return finish({ ok: true, available: failed < settings.calendars.length, partial: failed > 0, events: events.slice(0, 20), updated: now() });
    }
    var calendar = settings.calendars[index++], pages = 0, selected = [];
    function page(token) {
      var url = API + 'calendars/' + encodeURIComponent(calendar.id) + '/events?singleEvents=true&orderBy=startTime&maxResults=20&showDeleted=false&timeMin=' +
        encodeURIComponent(new Date(at).toISOString()) + '&timeMax=' + encodeURIComponent(new Date(at + 30 * 86400000).toISOString()) +
        (token ? '&pageToken=' + encodeURIComponent(token) : '');
      auth.api(url, function (err, result) {
        if (err || !result || !Array.isArray(result.items)) { failed++; return next(); }
        result.items.forEach(function (item) { var value = event(item, calendar, at); if (value) selected.push(value); });
        if (result.nextPageToken && selected.length < 20 && ++pages < 10) return page(result.nextPageToken);
        events = events.concat(selected);
        task.progress = { ok: true, available: true, loading: true, events: events.slice().sort(function (a, b) { return a.sort - b.sort; }).slice(0, 20) };
        next();
      });
    }
    page('');
  }
  function finish(data) {
    if (version === auth.revision()) cache = { key: key, updated: now(), data: data };
    if (inFlight === task) inFlight = null;
  }
  next();
}
module.exports = { normalise: normalise, read: read, calendars: calendars, auth: auth, event: event,
  init: function (opts) { opts = opts || {}; now = opts.now || Date.now; cache = null; inFlight = null; auth.init(opts); } };
