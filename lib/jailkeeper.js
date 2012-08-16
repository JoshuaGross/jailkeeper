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

  var operatingSystem = require('os').platform();
  var truss = ('solaris' === operatingSystem ? 'truss' : ('darwin' === operatingSystem ? 'dtruss' : 'truss'));

  var streamPrototype = function () {
    this.writable = true;
    this.reabable = true;
    return this;
  };
  util.inherits(streamPrototype, stream.Stream);
  jail.stderr = new streamPrototype();
  jail.stdout =  new streamPrototype();

  options = options || {};
  jail.options = options;
  jail.options.read = options.read || [];
  jail.options.write = options.write || [];

  jail.options.write.push('/dev/dtracehelper');
  jail.options.write.push('/dev/tty');

  if ('truss' === truss) {
    jail.options.read.push('/usr/bin/amd64/ksh93'); // joyent machines, for running node
    jail.options.read.push('/usr/spool/cron/atjobs'); // joyent machines, for running node. Seems sketchy.
    jail.options.read.push('/var/run/name_service_door'); // joyent machines, for running node
  } else if ('dtruss' === truss) {
    jail.options.read.push('/AppleInternal');
  }
  jail.options.read.push('/'); // for running node. Seems HELLA sketchy
  jail.options.read.push(/^\/dev\/pts\/[0-9]$/); // joyent machines, for running node
  jail.options.read.push('/dev/null'); // joyent machines, for running node
  jail.options.read.push('/dev/kstat'); // joyent machines, for running node
  jail.options.read.push('/dev/urandom');
  jail.options.read.push(/\/usr\/lib\/locale\/(.*?)/); // joyent machines, for running node
  jail.options.read.push(/^\/usr\/lib\/(.*?)\.dylib$/);
  jail.options.read.push('/var/ld/ld.config'); // joyent machines, for running node
  jail.options.read.push('/var/ld/64/ld.config'); // joyent machines, for running node
  jail.options.read.push(/\/lib\/64\/[^\/]+.so.[0-9]/); // joyent machines, for running node
  jail.options.read.push(/\/lib\/[^\/]+.so.[0-9]/); // joyent machines, for running node
  jail.options.read.push('/proc/self/auxv'); // joyent machines, for running node
  jail.options.read.push(path.resolve(__dirname+'/child.js'));
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
  var trussHasResponded = false;
  var trussKillTimer = null;
  var trussRespond = function (out) {
    if (!trussHasResponded) {
      trussHasResponded = true;
      jail.childProcess.send('trussReady');
    } else {
      if (trussKillTimer) clearTimeout(trussKillTimer);
      trussKillTimer = setTimeout(function () {
        if (jail.childProcess) {
          jail.childProcess.kill();
        }
      }, 1000);
    }

    var lines = out.toString().split(/\s*[\r\n]+\s*/);
    for (var i in lines) {
      var result = (function() {
        var line = lines[i];
        //console.log('truss sez', line)
        var matchStat64 = line.match(/stat([^\(]*)\(([^\)]+)\)/);
        var matchOpen = line.match(/open([^\(]*)\(([^\)]+)\)/);
        var pidMatch = line.match(/^([0-9]+)[\/:]/);
        var forkMatch = line.match(/fork\(\)\s*=\s*([0-9]+)\s*/);

        var pid = (pidMatch ? pidMatch[1] : null);
        if (forkMatch) {
          pid = forkMatch[1];
        }
        if (pid && pid > parentPID) {
          // This seems to sometimes work on Mac OS X, sometimes not - but my installation of dtruss is extremely slow. Regardless, everything works consistently without this on Solaris.
          if (!activePIDs[pid] && 'dtruss' === truss) spawnJail(pid);
          activePIDs[pid] = 1;
        }
        
        var file, mode;
        if (matchStat64) {
          var details = matchStat64[2].split(/\s*,\s*/);
          file = details[0];
          mode = 'read';
        } else if (matchOpen) {
          var details = matchOpen[2].split(/\s*,\s*/);
          file = details[0];
          mode = ('0x0' === details[1]
            ? 'read'
            : (/(^|\|)O_RDONLY($|\|)/.test(details[1])
              ? 'read'
              : 'write')); // 0x601 is definitely write
        }

        if (file || mode) {
          var matchQuotes = file.match(/^"([^"]+)"$/);
          if (matchQuotes) {
            file = matchQuotes[1];
            var matchNullTerminator = file.match(/^(.*?)\\0$/);
            if (matchNullTerminator) {
              file = matchNullTerminator[1];
            }
          }
          file = path.resolve(jail.options.cwd, file);

          // Allow reading and writing within the jail dir itself
          //if (path.dirname(file) === jail.options.cwd || file === jail.options.cwd) {
          if (path.dirname(file).indexOf(jail.options.cwd) === 0) {
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
    // Child has been killed but there are new processes being called? (why else would spawnJail be called?)
    if (jail.childProcess === null) {
      return process.kill(pid);
    }

    var trussArgs = ['-f', '-l'];
    if ('dtruss' === truss) trussArgs.push('-o');
    trussArgs.push('-p');
    trussArgs.push(pid);

    jails++;

    var jailProcess = spawn(truss, trussArgs);
    jailProcess.stderr.on('data', trussRespond);
    jailProcess.stdout.on('data', trussRespond);

    jail.childProcess.on('exit', function (code) {
      //console.log('child process exit');
      jail.childProcess = null;
      jail.stderr.emit('end');
      jail.stdout.emit('end');
      if (jailProcess) {
        jailProcess.kill();
      }
    });
    jailProcess.on('exit', function (code) {
      //console.log('jail process exit');
      jailProcess.stderr.removeListener('data', trussRespond);
      jailProcess.stdout.removeListener('data', trussRespond);
      jails--;
      if (0 === jails) {
        jail.emit('exit');
        if (jail.childProcess) {
          jail.childProcess.kill();
        }
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

    // Make all directories leading up to cwd, path, readable-files readable (there are lots of stat64 calls on these directories)
    jail.options.read.push(jail.options.cwd);
    var makeTraversalLegal = function (dir) {
      while ((dir = path.dirname(dir)) != '/') {
        jail.options.read.push(dir);
      }
    };
    for (var i in jail.options.read) {
      makeTraversalLegal(jail.options.read[i]);
    }

    jail.childProcess = fork(__dirname+'/child.js');
    jail.childProcess.send({cmd: cmd, args: args, options: options, stdout: jail.stdout, stderr: jail.stderr });
    parentPID = jail.childProcess.pid;
    activePIDs[parentPID] = 1;

    spawnJail(jail.childProcess.pid);

    return jail;
  };

  return jail;
};
util.inherits(module.exports, events.EventEmitter);
