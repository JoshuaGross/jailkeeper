var util = require('util');
var spawn = require('child_process').spawn;

var cmd, args, options, childProcess = null;

process.on('message', function(m) {
  if (m.cmd) cmd = m.cmd;
  if (m.args) args = m.args;
  if (m.options) options = m.options;

  if ('trussReady' === m) {
    if (childProcess === null) {
      childProcess = spawn(cmd, args, options);
      childProcess.stderr.on('data', function (d) {
        process.send({ stderr: d });
      });
      childProcess.stdout.on('data', function (d) {
        process.send({ stdout: d });
      });
      childProcess.on('exit', function (d) {
        childProcess.stderr.removeAllListeners('data');
        childProcess.stdout.removeAllListeners('data');
      });
    }
  }
});
