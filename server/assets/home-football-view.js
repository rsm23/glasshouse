(function () {
  var kit = /** @type {any} */ (window).WidgetKit, I18N = /** @type {any} */ (window).I18N;
  function message(data) {
    if (!data || data.loading) return I18N.t('home.football.loadingScores', 'Loading scores…');
    if (!data.available) return I18N.t('home.football.unavailable', 'Football scores unavailable');
    if (data.partial && !data.matches.length) return I18N.t('home.football.partial', 'Some scores are unavailable');
    return I18N.t('home.football.noMatches', 'No selected teams playing now');
  }
  function side(team) {
    var line = kit.node('div', 'fw-side');
    line.appendChild(kit.node('span', '', team.name));
    line.appendChild(kit.node('b', '', team.score === null ? '–' : String(team.score)));
    return line;
  }
  function dateLabel(match) {
    var date = new Date(match.date);
    /** @type {Intl.DateTimeFormatOptions} */
    var options = { day: 'numeric', month: 'short', year: 'numeric' };
    if (match.upcoming && match.timeValid) { options.hour = 'numeric'; options.minute = '2-digit'; }
    try { return new Intl.DateTimeFormat(I18N.lang(), options).format(date); }
    catch (e) { return match.upcoming && match.timeValid ? date.toLocaleString() : date.toLocaleDateString(); }
  }
  function row(match) {
    var box = kit.node('div', 'fw-row' + (match.upcoming ? ' fw-next' : '')); box.setAttribute('role', 'listitem');
    if (match.missing) {
      box.appendChild(kit.node('div', 'fw-side', match.name));
      box.appendChild(kit.node('div', 'fw-meta', match.unavailable ? I18N.t('home.football.resultUnavailable', 'Result unavailable')
        : I18N.t('home.football.noResult', 'No completed result available')));
      return box;
    }
    if (match.upcoming) box.appendChild(kit.node('div', 'fw-meta', I18N.t('home.football.nextMatch', 'Next match')));
    box.appendChild(side(match.home)); box.appendChild(side(match.away));
    box.appendChild(kit.node('div', 'fw-meta', (match.date ? dateLabel(match) : match.status) + (match.league ? ' · ' + match.league : '')));
    return box;
  }
  function offset(host) {
    var track = host.querySelector('.fw-track');
    if (!track) return 0;
    var style = window.getComputedStyle(track), transform = style.transform || style.webkitTransform || '';
    var parts = transform.replace(/^matrix(3d)?\(|\)$/g, '').split(',');
    return Math.max(0, -(+parts[parts.length === 16 ? 13 : 5] || 0));
  }
  function render(host, data, compact) {
    var signature = JSON.stringify([data && data.available, data && data.partial, data && data.loading, data && data.mode, data && data.matches, data && data.nextMatches, data && data.missingTeams, compact, compact && host.clientHeight]);
    if (host.footballSignature === signature) return;
    host.footballSignature = signature;
    var previousOffset = offset(host);
    host.innerHTML = ''; host.classList.add('fw-list');
    if (!data || !data.available || !data.matches.length && !(data.nextMatches && data.nextMatches.length) && !(data.missingTeams && data.missingTeams.length)) {
      host.appendChild(kit.node('p', 'wk-empty', message(data))); return;
    }
    var track = kit.node('div', 'fw-track'), group = kit.node('div', 'fw-group'); group.setAttribute('role', 'list');
    data.matches.forEach(function (match) { group.appendChild(row(match)); });
    (data.nextMatches || []).forEach(function (match) { group.appendChild(row(match)); });
    (data.missingTeams || []).forEach(function (team) { group.appendChild(row({ missing: true, name: team.name, unavailable: team.unavailable })); });
    track.appendChild(group); host.appendChild(track);
    if (!compact || group.offsetHeight <= host.clientHeight) return;
    var duplicate = group.cloneNode(true); duplicate.setAttribute('aria-hidden', 'true'); track.appendChild(duplicate);
    // Two equal groups make the last frame meet the first without an empty gap.
    var seconds = group.offsetHeight / 12, delay = -(previousOffset % group.offsetHeight) / 12;
    track.style.animationDuration = track.style.webkitAnimationDuration = seconds + 's';
    track.style.animationDelay = track.style.webkitAnimationDelay = delay + 's';
    track.classList.add('fw-scrolling');
  }
  /** @type {any} */ (window).FootballWidget = { render: render };
})();
