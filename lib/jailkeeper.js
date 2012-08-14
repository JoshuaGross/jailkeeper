/**
 * JailKeeper by Joshua Gross
 *
 * josh@spandex.io
 *
 * Started August 12, 2012.
 *
 * Released under the MIT license.
 */

var spawn = require('child_process').spawn
  , events = require('events')
  , util = require('util')
  , path = require('path');

module.exports = function (options) {
  var jail = this;
  events.EventEmitter.call(jail);

  options = options || {};
  options.cwd = options.cwd || process.cwd();
  options.cwd = path.resolve(options.cwd);
  options.read = options.read || [];
  options.write = options.write || [];

  options.write.push('/dev/dtracehelper');
  options.write.push('/dev/tty');

  options.read.push(/^\/usr\/lib\/(.*?)\.dylib$/);
  options.read.push('/AppleInternal');
  options.read.push('/bin');
  options.read.push('/usr/bin');

  for (var i in options.write) {
    options.read.push(options.write[i])
  }

  jail.childProcess = null;

  var jailbreak = function (mode, file) {
    jail.childProcess.stderr.removeListener('data', dtrussRespond);
    jail.childProcess.stdout.removeListener('data', dtrussRespond);
    jail.emit('jailbreak', {mode:mode, file:file});
    killChild();
    return true;
  };

  // Get a list of processes opened by some parent ID
  // If a process is spawned by another process we're watching... watch children too!
  var dtrussRespond = function (out) {
    var lines = out.toString().split(/\s*[\r\n]+\s*/);
    for (var i in lines) {
      var result = (function() {
        var line = lines[i];
        var matchStat64 = line.match(/stat64\(([^\)]+)\)/);
        var matchOpen = line.match(/open\(([^\)]+)\)/);
        
        var file, mode;
        if (matchStat64) {
          var details = matchStat64[1].split(/\s*,\s*/);
          file = details[0];
          mode = 'read';
        } else if (matchOpen) {
          var details = matchOpen[1].split(/\s*,\s*/);
          file = details[0];
          mode = ('0x0' === details[1] ? 'read' : 'write'); // 0x601 is definitely write
        }

        if (file || mode) {
          var matchQuotes = file.match(/^"([^"]+)\\0"$/);
          if (matchQuotes) {
            file = matchQuotes[1];
          }
          file = path.resolve(options.cwd, file);

          // Allow reading and writing within the jail dir itself
          if (path.dirname(file) === options.cwd || file === options.cwd) {
            return false;
          }

          // Check allow-read
          for (var j in options.read) {
            if (options.read[j].test && options.read[j].test(file)) {
              return false;
            } else if (options.read[j] === file) {
              return false;
            }
          }

          // Check allow-write
          if ('write' === mode) {
            for (var j in options.write) {
              if (options.write[j].test && options.write[j].test(file)) {
                return false;
              } else if (options.write[j] === file) {
                return false;
              }
            }
          }
          
          // JAILBREAK!
          return jailbreak(mode, file);
        }
      })();
      if (result) {
        return;
      }
    }
  };

  var killChild = function () {
    console.log('kill child')
    if (jail.childProcess) {
      var tmp = jail.childProcess;
      jail.childProcess = null;
      tmp.kill();
    }
  };

  jail.spawn = function (cmd) {
    var dtrussArgs = ['-f', '-l', '-o'];
    dtrussArgs.push(cmd);

    jail.childProcess = spawn('dtruss', dtrussArgs, { cwd: options.cwd });

    jail.childProcess.stderr.on('data', dtrussRespond);
    jail.childProcess.stdout.on('data', dtrussRespond);

    jail.childProcess.on('exit', function (code) {
      console.log('child process exited')
      jail.emit('exit');
    });
  };

  return jail;
};
util.inherits(module.exports, events.EventEmitter);
