var util = require('util');
var spawn = require('child_process').spawn;
var stream = require('stream');

var createChild = function (m) {
  var cmd, args, options;
  var childContainer = this;
  childContainer.childProcess = null;

  if (m.cmd) cmd = m.cmd;
  if (m.args) args = m.args;
  if (m.options) options = m.options;

  var onMessage = function (m) {
    if ('trussReady' === m) {
      if (childContainer.childProcess === null) {
        options = options || {};
        options.stdio = 'inherit';

        childContainer.childProcess = spawn(cmd, args, options);
        childContainer.childProcess.on('exit', function (code) {
          //console.log('child actually exited', code);
          process.exit();
        });
      }
      process.removeListener('message', onMessage);
    }
  };
  process.on('message', onMessage);
};

var initialResponse = function(m) {
  if (m.cmd) { 
    new createChild(m);
    process.removeListener('message', initialResponse);
  }
};

process.on('message', initialResponse);
