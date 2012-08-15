var expect = require('expect.js');
var fs = require('fs');
var sinon = require('sinon');
var JailKeeper = require('../');
var spawn = require('child_process').spawn;

describe('JailKeeper', function () {
  it('should allow simple harmless echo', function (done) {
    this.timeout(0);
    var jail = new JailKeeper();
    var childProcess = jail.spawn('./echoHello', [], { cwd: './test/fixtures' });
    var jailbroken = false;
    jail.on('jailbreak', function (code) {
      jailbroken = true;
    });
    jail.on('exit', function (code) {
      expect(jailbroken).to.be(false);
      done();
    });
  });
  it('should allow writing within jail dir', function (done) {
    var jail = new JailKeeper();
    var childProcess = jail.spawn('./echoHelloRedir', [], { cwd: './test/fixtures' });
    var jailbroken = false;
    jail.on('jailbreak', function (code) {
      jailbroken = true;
    });
    jail.on('exit', function (code) {
      expect(jailbroken).to.be(false);
      done();
    });
  });
  it('should allow reading within jail dir', function (done) {
    var jail = new JailKeeper();
    var childProcess = jail.spawn('./readRedirFile', [], { cwd: './test/fixtures' });
    var jailbroken = false;
    jail.on('jailbreak', function (code) {
      jailbroken = true;
    });
    jail.on('exit', function (code) {
      expect(jailbroken).to.be(false);
      done();
    });
  });
  it('should prevent reading test source', function (done) {
    var jail = new JailKeeper();
    var childProcess = jail.spawn('cat', ['../test.js'], { cwd: './test/fixtures' });
    var jailbroken = false;
    jail.on('jailbreak', function (code) {
      jailbroken = true;
    });
    jail.on('exit', function (code) {
      expect(jailbroken).to.be(true);
      done();
    });
  });
  it('should prevent reading package.json', function (done) {
    var jail = new JailKeeper();
    var childProcess = jail.spawn('cat', ['../../package.json'], { cwd: './test/fixtures' });
    var jailbroken = false;
    jail.on('jailbreak', function (code) {
      jailbroken = true;
    });
    jail.on('exit', function (code) {
      expect(jailbroken).to.be(true);
      done();
    });
  });
  it('should prevent reading password file', function (done) {
    var jail = new JailKeeper();
    var childProcess = jail.spawn('./readPasswordFile', [], { cwd: './test/fixtures' });
    var jailbroken = false;
    jail.on('jailbreak', function (code) {
      jailbroken = true;
    });
    jail.on('exit', function (code) {
      expect(jailbroken).to.be(true);
      done();
    });
  });
  it('should prevent writing to parent directory', function (done) {
    var jail = new JailKeeper();
    var childProcess = jail.spawn('./writeToParentDirectory', [], { cwd: './test/fixtures' });
    var jailbroken = false;
    jail.on('jailbreak', function (code) {
      jailbroken = true;
    });
    jail.on('exit', function (code) {
      expect(jailbroken).to.be(true);
      fs.stat('test/parentDirWrite.txt', function (deetz) {
        expect(deetz).to.be(null);
        done();
      });
    });
  });
  it('should prevent writing to system binary', function (done) {
    var jail = new JailKeeper();
    var childProcess = jail.spawn('./writeToSystemBinary', [], { cwd: './test/fixtures' });
    var jailbroken = false;
    jail.on('jailbreak', function (code) {
      jailbroken = true;
    });
    jail.on('exit', function (code) {
      expect(jailbroken).to.be(true);
      done();
    });
  });

  // This test is failing on Mac, but I think my copy of dtruss is failing
  it('should prevent writing to system binary via child process', function (done) {
    var jail = new JailKeeper();
    var childProcess = jail.spawn('./writeToSystemBinaryViaChild', [], { cwd: './test/fixtures' });
    var jailbroken = false;
    jail.on('jailbreak', function (code) {
      jailbroken = true;
    });
    jail.on('exit', function (code) {
      expect(jailbroken).to.be(true);
      done();
    });
  });
});
