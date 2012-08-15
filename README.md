JailKeeper
==========

JailKeeper was created for my needs on SpanDeX.io. SpanDeX and similar cloud services must run otherwise-unsecured shell scripts (in our case, LaTeX code which is turing-complete and can access the filesystem). Obviously this has huge security implications. Chroot jails make me a little uneasy and seem quite difficult to manage, and easy to break out of (though I'm open to decent, lightweight alternatives). SmartOS zones seem like a better choice but I don't understand them yet ;)

Thus, this is my first attempt at an alternative solution, which is to use truss or dtruss (Solaris/SmartOS or Mac OS X, respectively) to monitor all the input/output of a spawned child process. We can immediately see if a process attempts to open a file that it shouldn't, kill the process, and notify the user (and server admins) that something funny is going on.

Warning: I have only extensively tested this on Joyent's SmartMachines, and I believe that there's something wrong with dtruss on Mac OS 10.8 so I haven't been able to test extensively on my local machine. Thus SmartOS/Solaris is supported well, but YMMV with other operating systems.

Installation
============

You know the drill: 

    npm install jailkeeper

Usage
=====

Create a new JailKeeper and then call JailKeeper.spawn, just as you would use child_process.spawn:

    var jail = new JailKeeper();
    var childProcess = jail.spawn('echo "hello world"', [], { cwd: './tmp/jail1' });
    console.log(childProcess.pid);
    childProcess.stdout.on('data', function (data) {
      console.log('Should say hello world: ', data.toString());
    })

JailKeeper attaches itself to that child process and ensures that only files within the child's initial CWD are read or written to. 

You can allow a jailed process more rights:

    var jail = new JailKeeper(childProcess, { read: ['/usr/bin'], write: ['./tmp/jail2'] });

This allows the jail to access binaries in /usr/bin and write to ./tmp/jail2. 

JailKeeper is an EventEmitter so you can attach to this event:

    jail.on('jailbreak', function (message) {
      // Super sad!
      console.log('User tried to jailbreak by attempting to "' + message.mode + '"  the file ' + message.file);
    });
    jail.on('exit', function (code) {
      });

The JailKeeper itself dies upon jailbreak, or when the child process otherwise executes. 

Contact
=======

Please contact me with any security concerns or ideas to make this more awesome:

    josh@spandex.io
