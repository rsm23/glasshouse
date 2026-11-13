(function () {
  var kit = /** @type {any} */ (window).WidgetKit, I18N = /** @type {any} */ (window).I18N;
  function day(value) { var parts = value.split('-'); return new Date(+parts[0], +parts[1] - 1, +parts[2]); }
  function dateLabel(event) {
    var date = event.allDay ? day(event.start) : new Date(event.start);
    /** @type {Intl.DateTimeFormatOptions} */
    var options = { weekday: 'short', month: 'short', day: 'numeric' };
    if (!event.allDay) { options.hour = 'numeric'; options.minute = '2-digit'; }
    try { return new Intl.DateTimeFormat(I18N.lang(), options).format(date); }
    catch (e) { return event.allDay ? date.toLocaleDateString() : date.toLocaleString(); }
  }
  function render(host, data, compact) {
    host.innerHTML = ''; host.classList.add('calendar-list');
    if (!data || !data.available) {
      host.appendChild(kit.node('p', 'wk-empty', !data || data.loading ? I18N.t('home.calendar.loadingEvents', 'Loading events…') : I18N.t('home.calendar.unavailable', 'Calendar unavailable. Check its connection in the dashboard.'))); return;
    }
    var events = (data.events || []).filter(function (event) {
      return (event.allDay ? day(event.end).getTime() : Date.parse(event.end)) > Date.now();
    });
    if (!events.length) { host.appendChild(kit.node('p', 'wk-empty', data.loading ? I18N.t('home.calendar.loadingEvents', 'Loading events…') : I18N.t('home.calendar.empty', 'No upcoming events in the next 30 days.'))); return; }
    host.setAttribute('role', 'list');
    events.slice(0, compact ? 2 : 20).forEach(function (event) {
      var row = kit.node('div', 'calendar-event'); row.setAttribute('role', 'listitem');
      row.appendChild(kit.node('div', 'calendar-event-title', event.title || I18N.t('home.calendar.untitled', 'Untitled event')));
      row.appendChild(kit.node('div', 'calendar-event-time', dateLabel(event) + (event.allDay ? ' · ' + I18N.t('home.calendar.allDay', 'All day') : '')));
      if (!compact) {
        row.appendChild(kit.node('div', 'calendar-event-detail', event.calendar));
        if (event.location) row.appendChild(kit.node('div', 'calendar-event-detail', event.location));
      }
      host.appendChild(row);
    });
  }
  /** @type {any} */ (window).CalendarWidget = { render: render };
})();
