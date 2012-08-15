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
  , stream = require('stream')
  , fork = require('child_process').fork
  , events = require('events')
  , util = require('util')
  , path = require('path');

require('./regex.js');

module.exports = function (options) {
  var jail = this;
  var parentPID;
  var activePIDs = {};
  events.EventEmitter.call(jail);

  var streamPrototype = function () {
    this.writable = true;
    this.reabable = true;
    return this;
  };
  util.inherits(streamPrototype, stream.Stream);
  jail.stderr = new stream.Stream();
  jail.stdout =  new streamPrototype();

  options = options || {};
  jail.options = options;
  jail.options.read = options.read || [];
  jail.options.write = options.write || [];

  jail.options.write.push('/dev/dtracehelper');
  jail.options.write.push('/dev/tty');

  jail.options.read.push(/^\/usr\/lib\/(.*?)\.dylib$/);
  jail.options.read.push('/AppleInternal');
  jail.options.read.push(path.resolve('./lib/child.js'));
  jail.options.read.push(process.cwd()); // not sure why needed

  for (var i in jail.options.write) {
    jail.options.read.push(options.write[i])
  }

  jail.childProcess = null;

  var jailbreak = function (mode, file) {
    if (jail.childProcess) {
      jail.emit('jailbreak', {mode:mode, file:file});
      killChild();
    }
    return true;
  };

  // Get a list of processes opened by some parent ID
  // If a process is spawned by another process we're watching... watch children too!
  var dtrussHasResponded = false;
  var dtrussKillTimer = null;
  var dtrussRespond = function (out) {
    if (!dtrussHasResponded) {
      dtrussHasResponded = true;
      jail.childProcess.send('trussReady');
    } else {
      if (dtrussKillTimer) clearTimeout(dtrussKillTimer);
      dtrussKillTimer = setTimeout(function () {
        if (jail.childProcess) {
          jail.childProcess.kill();
        }
      }, 10);
    }

    var lines = out.toString().split(/\s*[\r\n]+\s*/);
    for (var i in lines) {
      var result = (function() {
        var line = lines[i];
        //console.log('truss sez', line)
        var matchStat64 = line.match(/stat64\(([^\)]+)\)/);
        var matchOpen = line.match(/open\(([^\)]+)\)/);
        var pidMatch = line.match(/^([0-9]+)\//);
        var forkMatch = line.match(/fork\(\)\s*=\s*([0-9]+)\s*/);

        var pid = (pidMatch ? pidMatch[1] : null);
        if (forkMatch) {
          pid = forkMatch[1];
        }
        if (pid && pid > parentPID) {
          // This seems to sometimes work on Mac OS X, sometimes not - but my installation of dtruss is extremely slow. Regardless, everything works consistently without this on Solaris.
          //if (!activePIDs[pid]) spawnJail(pid);
          activePIDs[pid] = 1;
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
          var matchQuotes = file.match(/^"([^"]+)(\\+0)*"$/);
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

  var jails = 0;
  var spawnJail = function (pid, cmd, args) {
    var operatingSystem = require('os').platform();
    var truss = ('solaris' === operatingSystem ? 'truss' : ('darwin' === operatingSystem ? 'dtruss' : 'truss'));

    // Child has been killed but there are new processes being called? (why else would spawnJail be called?)
    if (jail.childProcess === null) {
      return process.kill(pid);
    }

    var dtrussArgs = ['-f', '-l'];
    if ('dtruss' === truss) dtrussArgs.push('-o');
    dtrussArgs.push('-p');
    dtrussArgs.push(pid);

    jails++;

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
      jail.stderr.emit('end');
      jail.stdout.emit('end');
      jailProcess.stderr.removeListener('data', dtrussRespond);
      jailProcess.stdout.removeListener('data', dtrussRespond);
      jails--;
      if (0 === jails) {
        jail.emit('exit');
      }
      jailProcess = null;
    });
  };

  jail.spawn = function (cmd, args, options) {
    if (jail.childProcess !== null) {
      throw new Error('This jailer still has an active child process. Please use a different jailer or wait until this one has finished.');
      return null;
    }

    options = options || [];
    jail.options.cwd = options.cwd || process.cwd();
    jail.options.cwd = path.resolve(jail.options.cwd);

    options.env = options.env || {};
    options.env.PATH = options.env.PATH || process.env.PATH;

    // At least everything in PATH must be readable
    var pathSplit = options.env.PATH.split(':');
    for (var i in pathSplit) {
      var sep = (/\/$/.test(pathSplit[i]) ? '' : '/');
      jail.options.read.push(new RegExp('^'+RegExp.escape(pathSplit[i]+sep)+'[^\\/]+$'));
    }

    // Make all directories leading up to cwd readable
    var cwdCursor = jail.options.cwd;
    while (cwdCursor = path.dirname(cwdCursor)) {
      jail.options.read.push(cwdCursor);
    }

    jail.childProcess = fork('lib/child.js');
    jail.childProcess.send({cmd: cmd, args: args, options: options});
    parentPID = jail.childProcess.pid;
    activePIDs[parentPID] = 1;

    jail.childProcess.on('message', function (m) {
      if (m.stderr) {
        jail.stderr.emit('data', m.stderr);
      }
      if (m.stdout) {
        jail.stdout.emit('data', m.stdout);
      }
    });

    spawnJail(jail.childProcess.pid);

    return jail;
  };

  return jail;
};
util.inherits(module.exports, events.EventEmitter);
