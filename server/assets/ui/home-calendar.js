let homeCalendarStatus = null;
let homeCalendarCalendars = [];
let homeCalendarCredentials = null;
let homeCalendarBusy = false;
let homeCalendarNote = '';
let homeCalendarTimer = null;

function homeCalendarFields(settings, off) {
  const disabled = off || homeCalendarBusy ? 'disabled' : '';
  const connected = homeCalendarStatus?.connected;
  const loopback = location.protocol === 'http:' && location.hostname === '127.0.0.1';
  return `<div class="home-widget-fields home-calendar-fields">
    <p class="prot-desc">${esc(t('home.calendar.privacy', 'Google Calendar access is read-only. Selected event titles, times and locations appear on the TV. Google credentials stay on the TV and are excluded from backups and widget exports.'))}</p>
    <p class="prot-desc" role="status">${esc(homeCalendarNote || (homeCalendarBusy ? t('home.calendar.loading', 'Loading calendars…') :
      homeCalendarStatus?.pending ? t('home.calendar.pending', 'Finish signing in in the Google window.') :
      homeCalendarStatus?.errorCode ? t('home.calendar.signInFailed', 'Google sign-in did not finish. Try connecting again.') :
      connected ? t('home.calendar.connected', 'Google Calendar connected') : t('home.calendar.disconnected', 'Google Calendar is not connected.')))}</p>
    ${!connected ? `<p class="prot-desc">${esc(t('home.calendar.setup', 'Enable the Google Calendar API in Google Cloud, configure the consent screen, and download OAuth credentials for a Desktop app. Choose that JSON file below.'))}
      <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">${esc(t('home.calendar.openCloud', 'Open Google Cloud'))}</a></p>
      ${!loopback ? `<p class="prot-desc">${esc(t('home.calendar.tunnel', 'For Google sign-in, open an SSH tunnel from this computer: ssh -L 18080:127.0.0.1:8080 root@TV_ADDRESS. Then open http://127.0.0.1:18080 and return to this widget. Use the configured dashboard port if it differs from 8080.'))}</p>` : ''}
      <label>${esc(t('home.calendar.credentials', 'Desktop OAuth credential file'))}<input type="file" accept=".json,application/json" ${disabled} onchange="homeCalendarChooseFile(this)"></label>
      ${homeCalendarCredentials ? `<p class="prot-desc">${esc(t('home.calendar.fileReady', 'Credential file ready.'))}</p>` : ''}
      <button type="button" class="pill good" ${disabled || !loopback ? 'disabled' : ''} onclick="homeCalendarConnect()">${esc(t('home.calendar.signIn', 'Sign in with Google'))}</button>` : ''}
    ${connected ? `<button type="button" class="pill idle" ${disabled} onclick="homeCalendarLoad()">${esc(t('home.calendar.refresh', 'Refresh calendars'))}</button>
      <div class="home-football-choices" role="group" aria-label="${esc(t('home.calendar.choose', 'Calendars to display'))}">
      ${homeCalendarCalendars.map((calendar, index) => `<label><input type="checkbox" ${disabled} ${settings.calendars.some(item => item.id === calendar.id) ? 'checked' : ''} onchange="homeCalendarSelect(${index}, this.checked)"> <span>${esc(calendar.name)}</span></label>`).join('')}
      ${!homeCalendarCalendars.length && !homeCalendarBusy ? esc(t('home.calendar.noCalendars', 'No readable calendars found.')) : ''}</div>
      <p class="prot-desc">${esc(t('home.calendar.selectionHelp', 'Select up to eight calendars, then turn the widget on. It shows the next events within 30 days. Press OK on the TV for the full list.'))}</p>
      <button type="button" class="pill bad" ${disabled} onclick="homeCalendarDisconnect()">${esc(t('home.calendar.disconnect', 'Disconnect Google Calendar'))}</button>` : ''}
    ${!homeCalendarStatus && !homeCalendarBusy ? `<button type="button" class="pill idle" ${off} onclick="homeCalendarLoad()">${esc(t('home.calendar.refresh', 'Refresh calendars'))}</button>` : ''}
  </div>`;
}

async function homeCalendarChooseFile(input) {
  const file = input.files[0]; homeCalendarCredentials = null;
  try {
    if (!file || file.size > 16384) throw new Error();
    const value = JSON.parse(await file.text());
    if (!value.installed?.client_id || !value.installed?.client_secret) throw new Error();
    homeCalendarCredentials = { installed: { client_id: value.installed.client_id, client_secret: value.installed.client_secret } };
    homeCalendarNote = '';
  } catch (error) { homeCalendarNote = t('home.calendar.badFile', 'Choose a valid Desktop OAuth JSON file, no larger than 16 KB.'); }
  renderHomeWidgets();
}

async function homeCalendarLoad() {
  if (homeCalendarBusy) return;
  homeCalendarBusy = true; homeCalendarNote = ''; renderHomeWidgets();
  try {
    homeCalendarStatus = await homeGet('/api/home/widgets/calendar/status');
    homeCalendarCalendars = homeCalendarStatus.connected ? (await homePost('/api/home/widgets/calendar/calendars', {})).calendars : [];
    if (homeCalendarStatus.pending) homeCalendarPoll(Date.now() + 10 * 60000);
  } catch (error) { homeCalendarNote = error.message; }
  homeCalendarBusy = false; renderHomeWidgets();
}

async function homeCalendarConnect() {
  if (!homeWritable() || homeCalendarBusy) return;
  if (!homeCalendarCredentials) { homeCalendarNote = t('home.calendar.badFile', 'Choose a valid Desktop OAuth JSON file, no larger than 16 KB.'); renderHomeWidgets(); return; }
  const popup = window.open('about:blank', '_blank');
  if (!popup) { homeCalendarNote = t('home.calendar.popup', 'Allow pop-up windows to sign in with Google.'); renderHomeWidgets(); return; }
  popup.opener = null;
  homeCalendarBusy = true; homeCalendarNote = ''; renderHomeWidgets();
  try {
    const result = await homePost('/api/home/widgets/calendar/connect', { credentials: homeCalendarCredentials });
    homeCalendarCredentials = null; popup.location.href = result.url;
    homeCalendarStatus = { connected: false, pending: true }; homeCalendarPoll(Date.now() + 10 * 60000);
  } catch (error) { popup.close(); homeCalendarNote = error.message; }
  homeCalendarBusy = false; renderHomeWidgets();
}

function homeCalendarPoll(deadline) {
  clearTimeout(homeCalendarTimer);
  homeCalendarTimer = setTimeout(async () => {
    if (!q('home-widget-manager').open) return;
    try {
      homeCalendarStatus = await homeGet('/api/home/widgets/calendar/status');
      if (!homeCalendarStatus.pending) { await homeCalendarLoad(); return; }
      renderHomeWidgets();
    } catch (error) { homeCalendarNote = error.message; renderHomeWidgets(); return; }
    if (Date.now() < deadline) homeCalendarPoll(deadline);
  }, 2000);
}

function homeCalendarSelect(index, checked) {
  if (!homeWritable()) return;
  const calendar = homeCalendarCalendars[index]; if (!calendar) return;
  const widgets = homeWidgetSettings();
  widgets.calendar.calendars = widgets.calendar.calendars.filter(item => item.id !== calendar.id);
  if (checked) {
    if (widgets.calendar.calendars.length >= 8) { showErr(t('home.calendar.limit', 'Select no more than eight calendars.')); renderHomeWidgets(); return; }
    widgets.calendar.calendars.push({ id: calendar.id, name: calendar.name });
  }
  if (!widgets.calendar.calendars.length) widgets.calendar.enabled = false;
  homeSaveLayout({ widgets });
}

async function homeCalendarDisconnect() {
  if (!homeWritable() || homeCalendarBusy) return;
  homeCalendarBusy = true; homeCalendarNote = ''; renderHomeWidgets(); clearTimeout(homeCalendarTimer);
  try {
    const reply = await homePost('/api/home/widgets/calendar/disconnect', {});
    homeCalendarStatus = reply; homeCalendarCalendars = []; homeCalendarCredentials = null;
    if (reply.revoked === false) homeCalendarNote = t('home.calendar.revokeFailed', 'Disconnected from the TV. Google could not confirm revocation; remove Glasshouse access in Google Account settings.');
    const widgets = homeWidgetSettings(); widgets.calendar.enabled = false; widgets.calendar.calendars = [];
    await homeSaveLayout({ widgets });
  } catch (error) { homeCalendarNote = error.message; }
  homeCalendarBusy = false; renderHomeWidgets();
}
