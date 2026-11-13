var fs = require('fs');
var children = require('./children');
var execFileFn = function (bin, args, opts, cb) { return require('child_process').execFile(bin, args, opts, cb); };
var client = null;

function quoted(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n') + '"';
}

function curl() {
  if (client) return client;
  var paths = ['/media/developer/bin/curl', '/usr/local/bin/curl', '/opt/bin/curl', '/opt/usr/bin/curl',
    '/var/lib/webosbrew/bin/curl', '/home/root/bin/curl', '/usr/bin/curl', '/bin/curl'];
  for (var i = 0; i < paths.length; i++) if (fs.existsSync(paths[i])) return (client = paths[i]);
  return null;
}

function request(url, options, cb) {
  var bin = curl();
  if (!bin || !/^https:\/\/(oauth2\.googleapis\.com\/(token|revoke)|www\.googleapis\.com\/calendar\/v3\/[^\s]*)$/.test(url)) return cb(new Error('Google request unavailable'));
  var config = ['silent', 'show-error', 'connect-timeout = 5', 'max-time = 15', 'proto = "=https"',
    'url = ' + quoted(url), 'write-out = "\\n%{http_code}"'];
  if (options.token) config.push('header = ' + quoted('Authorization: Bearer ' + options.token));
  if (options.form) {
    config.push('header = "Content-Type: application/x-www-form-urlencoded"');
    config.push('data = ' + quoted(Object.keys(options.form).map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(options.form[key]);
    }).join('&')));
  }
  // Credentials travel on stdin, outside process arguments and error messages.
  children.launch(function () {
    var child = execFileFn(bin, ['--disable', '--config', '-'], { timeout: 20000, maxBuffer: 2 * 1024 * 1024 }, function (err, stdout) {
      if (err) return cb(new Error('Google request failed'));
      var split = stdout.lastIndexOf('\n'), status = +stdout.slice(split + 1), result;
      try { result = JSON.parse(stdout.slice(0, split) || '{}'); }
      catch (e) { return cb(new Error('Invalid Google response')); }
      cb(null, result, status);
    });
    child.stdin.on('error', function () {});
    child.stdin.end(config.join('\n') + '\n');
  });
}

module.exports = {
  request: request,
  init: function (opts) { opts = opts || {}; client = opts.client || null; execFileFn = opts.execFile || function (bin, args, options, cb) { return require('child_process').execFile(bin, args, options, cb); }; }
};
