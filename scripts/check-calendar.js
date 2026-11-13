const assert = require('assert');
const path = require('path');

module.exports = async function visitHomeCalendar(browser, base, problems) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => problems.push('Calendar: ' + error.message));
  const normalise = require('../server/lib/home-widgets').normalise;
  let layout = { rows: ['app', 'dev', 'ch'], order: { app: [], dev: [], ch: [] }, hidden: { app: [], dev: [], ch: [] },
    channels: [], showClock: true, showLastOn: false, picture: false, hintSeen: true, searchHintSeen: true, widgets: normalise(null) };
  let connected = false, pending = false, version = 1, eventsState = 'ready';
  const credentials = { installed: { client_id: 'synthetic.apps.googleusercontent.com', client_secret: 'synthetic-secret' } };
  const day = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const nextDay = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const events = [
    { id: 'one', title: '<b>Planning</b>', start: new Date(Date.now() + 3600000).toISOString(), end: new Date(Date.now() + 7200000).toISOString(), calendar: 'Personal', location: 'Office' },
    { id: 'two', title: 'Holiday', allDay: true, start: day, end: nextDay, calendar: 'Family', location: '' },
    { id: 'three', title: 'Dinner', start: new Date(Date.now() + 3 * 3600000).toISOString(), end: new Date(Date.now() + 4 * 3600000).toISOString(), calendar: 'Family', location: 'Restaurant' }
  ];
  await page.route('**/api/home**', route => {
    const url = new URL(route.request().url()), pathname = url.pathname;
    const reply = json => route.fulfill({ json });
    if (pathname === '/api/home') return reply({ ok: true, supported: { ok: true }, enabled: true, active: true, writable: true, layout });
    if (pathname === '/api/home/catalogue') return reply({ ok: true, layout, layoutVersion: String(version), apps: [], devices: [], channels: [], order: { app: ['lg-home'], dev: [], ch: [] }, sources: {} });
    if (pathname === '/api/home/layout') { layout = { ...layout, ...route.request().postDataJSON() }; layout.widgets = normalise(layout.widgets); version++; return reply({ ok: true, layout }); }
    if (pathname === '/api/home/widgets/calendar/status') return reply({ ok: true, connected, pending });
    if (pathname === '/api/home/widgets/calendar/connect') {
      assert.deepStrictEqual(route.request().postDataJSON(), { credentials }); pending = true;
      return reply({ ok: true, url: 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic' });
    }
    if (pathname === '/api/home/widgets/calendar/calendars') return reply({ ok: true, calendars: [{ id: 'personal', name: 'Personal' }, { id: 'family', name: 'Family' }] });
    if (pathname === '/api/home/widgets/calendar/disconnect') { connected = false; return reply({ ok: true, connected: false, revoked: true }); }
    if (pathname === '/api/home/widgets/calendar') return reply(eventsState === 'error' ? { ok: true, available: false, events: [] } : { ok: true, available: true, events: eventsState === 'empty' ? [] : events });
    return reply({ ok: true, layoutVersion: String(version), build: 'calendar-fixture', covered: false });
  });
  async function editor() {
    await page.getByRole('button', { name: 'Manage widgets', exact: true }).click();
    await page.locator('[data-widget-pick="calendar"]').click();
    await page.waitForFunction(() => homeCalendarStatus && !homeCalendarBusy);
  }
  try {
    await page.goto(base + '/?tab=home'); await editor();
    const host = page.locator('#home-widgets');
    await host.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
    await host.getByText('Choose a valid Desktop OAuth JSON file, no larger than 16 KB.', { exact: true }).waitFor();
    await host.locator('input[type=file]').setInputFiles({ name: 'synthetic-client.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(credentials)) });
    await host.getByText('Credential file ready.', { exact: true }).waitFor();
    await page.evaluate(() => { window.open = () => (window.calendarPopup = { location: {}, close() {} }); });
    await host.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
    await page.waitForFunction(() => homeCalendarStatus.pending && window.calendarPopup.location.href);
    assert.ok((await page.evaluate(() => window.calendarPopup.location.href)).startsWith('https://accounts.google.com/'));
    connected = true; pending = false;
    await page.evaluate(() => homeCalendarLoad());
    await host.getByLabel('Personal', { exact: true }).check();
    await page.waitForFunction(() => !homeSaving && homeLayout.widgets.calendar.calendars.length === 1);
    await page.locator('#home-widget-list [data-widget-toggle="calendar"]').click();
    await page.waitForFunction(() => !homeSaving && homeLayout.widgets.calendar.enabled);
    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      await page.waitForFunction(expected => getComputedStyle(document.querySelector('#home-widgets [data-widget-toggle="calendar"]')).color === expected,
        theme === 'light' ? 'rgb(21, 127, 55)' : 'rgb(48, 222, 97)');
      await page.setViewportSize({ width: 390, height: 844 });
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const overflow = await host.evaluate(el => [...el.querySelectorAll('input,button,select')].some(control => {
        const box = control.getBoundingClientRect(), parent = el.getBoundingClientRect();
        return box.width && (box.left < parent.left - 1 || box.right > parent.right + 1);
      }));
      assert.strictEqual(overflow, false, 'calendar controls fit the phone editor');
      const contrast = await host.evaluate(el => {
        function channels(value) { return value.match(/[\d.]+/g).map(Number); }
        const background = channels(getComputedStyle(document.getElementById('home-widget-manager')).backgroundColor);
        function luminance(rgb) { return rgb.slice(0, 3).map(value => { const part = value / 255; return part <= 0.04045 ? part / 12.92 : Math.pow((part + 0.055) / 1.055, 2.4); }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0); }
        return [el.querySelector('.home-calendar-fields .prot-desc'), el.querySelector('[data-widget-toggle="calendar"]')].map(control => {
          const color = channels(getComputedStyle(control).color), alpha = color[3] ?? 1;
          const foreground = color.map((value, index) => value * alpha + background[index] * (1 - alpha));
          const a = luminance(foreground), b = luminance(background);
          return { color: getComputedStyle(control).color, background, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
        });
      });
      assert.ok(contrast.every(value => value.ratio >= 4.5), JSON.stringify({ theme, contrast }));
    }
    await page.screenshot({ path: path.join(__dirname, '../docs/screenshots/home-calendar-settings-preview.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await host.getByRole('button', { name: 'Refresh calendars', exact: true }).click();
    await page.waitForFunction(() => !homeCalendarBusy);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(base + '/assets/home.html');
    await page.locator('#widget-calendar .calendar-event').first().waitFor();
    assert.strictEqual(await page.locator('#widget-calendar .calendar-event').count(), 2);
    assert.strictEqual(await page.locator('#widget-calendar b').count(), 0, 'event titles remain literal text');
    assert.ok((await page.locator('#widget-calendar').innerText()).includes('All day'));
    await page.screenshot({ path: path.join(__dirname, '../docs/screenshots/home-calendar-preview.png') });
    await page.locator('#widget-calendar').focus(); await page.keyboard.press('Enter');
    await page.locator('.calendar-expanded .calendar-event').first().waitFor();
    assert.strictEqual(await page.locator('.calendar-expanded .calendar-event').count(), 3);
    assert.ok((await page.locator('.calendar-expanded').innerText()).includes('Office'));
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('#widget--panel').count(), 0);
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'widget-calendar');
    for (const state of ['empty', 'error']) {
      eventsState = state; await page.reload();
      await page.locator('#widget-calendar').getByText(state === 'empty' ? 'No upcoming events in the next 30 days.' : 'Calendar unavailable. Check its connection in the dashboard.', { exact: true }).waitFor();
    }
    await page.goto(base + '/?tab=home'); await editor();
    await host.getByRole('button', { name: 'Disconnect Google Calendar', exact: true }).click();
    await page.waitForFunction(() => !homeCalendarBusy && !homeSaving && !homeLayout.widgets.calendar.enabled && !homeLayout.widgets.calendar.calendars.length);
    await host.getByText('Google Calendar is not connected.', { exact: true }).waitFor();
  } finally { await page.close(); }
};
