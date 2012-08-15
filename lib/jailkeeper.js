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
  var activePIDs = {};
  events.EventEmitter.call(jail);

  options = options || {};
  jail.options = options;
  jail.options.read = options.read || [];
  jail.options.write = options.write || [];

  jail.options.write.push('/dev/dtracehelper');
  jail.options.write.push('/dev/tty');

  jail.options.read.push(/^\/usr\/lib\/(.*?)\.dylib$/);
  jail.options.read.push('/AppleInternal');
  jail.options.read.push('/bin');
  jail.options.read.push('/usr/bin');

  for (var i in jail.options.write) {
    jail.options.read.push(options.write[i])
  }

  jail.childProcess = null;

  var jailbreak = function (mode, file) {
    if (jail.childProcess) {
      jail.childProcess.stderr.removeListener('data', dtrussRespond);
      jail.childProcess.stdout.removeListener('data', dtrussRespond);
      jail.emit('jailbreak', {mode:mode, file:file});
      killChild();
    }
    return true;
  };

  // Get a list of processes opened by some parent ID
  // If a process is spawned by another process we're watching... watch children too!
  var dtrussRespond = function (out) {
    var lines = out.toString().split(/\s*[\r\n]+\s*/);
    for (var i in lines) {
      var result = (function() {
        var line = lines[i];
        //console.log('jailer sez', line);
        var matchStat64 = line.match(/stat64\(([^\)]+)\)/);
        var matchOpen = line.match(/open\(([^\)]+)\)/);
        var pidMatch = line.match(/^([0-9]+)\//);

        if (pidMatch) {
          activePIDs[pidMatch[1]] = 1;
        }
        
        var file, mode;
        if (matchStat64) {
          var details = matchStat64[1].split(/\s*,\s*/);
          file = details[0];
          mode = 'read';
        } else if (matchOpen) {
          var details = matchOpen[1].split(/\s*,\s*/);
          file = details[0];
          mode = ('0x0' === details[1]
            ? 'read'
            : (/(^|\|)O_RDONLY($|\|)/.test(details[1])
              ? 'read'
              : 'write')); // 0x601 is definitely write
        }

        if (file || mode) {
          var matchQuotes = file.match(/^"([^"]+)[\\0]?"$/);
          if (matchQuotes) {
            file = matchQuotes[1];
          }
          file = path.resolve(jail.options.cwd, file);

          // Allow reading and writing within the jail dir itself
          if (path.dirname(file) === jail.options.cwd || file === jail.options.cwd) {
            return false;
          }

          // Check allow-read
          for (var j in jail.options.read) {
            if (jail.options.read[j].test && jail.options.read[j].test(file)) {
              return false;
            } else if (jail.options.read[j] === file) {
              return false;
            }
          }

          // Check allow-write
          if ('write' === mode) {
            for (var j in jail.options.write) {
              if (jail.options.write[j].test && jail.options.write[j].test(file)) {
                return false;
              } else if (jail.options.write[j] === file) {
                return false;
              }
            }
          }
          
          // JAILBREAK!
          console.log('Jailbreak at:', mode, file, line);
          return jailbreak(mode, file);
        }
      })();
      if (result) {
        return;
      }
    }
  };

  var killChild = function () {
    if (jail.childProcess) {
      for (var pid in activePIDs) {
        spawn('kill', ['-9', pid]);
      }

      // Attempt to kill processes forever, until they die
      process.nextTick(killChild);
    }
  };

  jail.spawn = function (cmd, args, options) {
    if (jail.childProcess !== null) {
      throw new Error('This jailer still has an active child process. Please use a different jailer or wait until this one has finished.');
      return null;
    }

    var operatingSystem = require('os').platform();
    var truss = ('solaris' === operatingSystem ? 'truss' : ('darwin' === operatingSystem ? 'dtruss' : 'truss'));

    options = options || [];
    jail.options.cwd = options.cwd || process.cwd();
    jail.options.cwd = path.resolve(jail.options.cwd);

    jail.childProcess = spawn(cmd, args, { cwd: jail.options.cwd });
    //jail.childProcess.stderr.on('data', function (d) { console.log('childproces sez', d.toString())});
    //jail.childProcess.stdout.on('data', function (d) { console.log('childproces sez', d.toString())});
    activePIDs[jail.childProcess.pid] = 1;

    var dtrussArgs = ['-f', '-l'];
    if ('dtruss' === truss) dtrussArgs.push('-o');
    dtrussArgs.push('-p');
    dtrussArgs.push(jail.childProcess.pid);

    var jailProcess = spawn(truss, dtrussArgs);
    jailProcess.stderr.on('data', dtrussRespond);
    jailProcess.stdout.on('data', dtrussRespond);

    jail.childProcess.on('exit', function (code) {
      //console.log('child process exit');
      jail.childProcess = null;
      if (jailProcess) {
        jailProcess.kill();
      }
    });
    jailProcess.on('exit', function (code) {
      //console.log('jail process exit');
      jailProcess.stderr.removeListener('data', dtrussRespond);
      jailProcess.stdout.removeListener('data', dtrussRespond);
      jail.emit('exit');
      jailProcess = null;
    });

    return;
  };

  return jail;
};
util.inherits(module.exports, events.EventEmitter);
