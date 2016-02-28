var AlbumArt = require('../lib/album_art.js');
var fs = require('fs');
var serverCode = fs.readFileSync('lib/server.js') + "";
serverCode = serverCode.replace("#!/usr/bin/env node", "");
serverCode = serverCode.replace(/'.\//g, "'../lib/");
eval(serverCode);
var Player = require('../lib/player.js');
var assert = require('assert');
var leveldown = require('leveldown');

var testRunFolder = "run_tests";
var albumartFolder = testRunFolder + "/albumart";
var dbFolder = testRunFolder + "/db";

function deleteRecursiveSync(path) {
  if(fs.statSync(path).isDirectory()) {
    fs.readdirSync(path).forEach(function(child) {
      deleteRecursiveSync(path + "/" + child);
    });
    fs.rmdirSync(path);
  }
  else {
    fs.unlinkSync(path);
  }
}

describe("AlbumArt", function() {

  before(function() {
    // runs before all tests in this block
  });

  after(function() {
    // runs after all tests in this block
  });

  beforeEach(function() {
    fs.exists(testRunFolder, function(exists) {
      if(exists) {
        deleteRecursiveSync(testRunFolder);	
      }
      fs.mkdirSync(testRunFolder);
      fs.mkdirSync(dbFolder);
    });
  });

  afterEach(function() {
    // runs after each test in this block
  });

  // test cases
  describe("constructor", function() {
    it("create the albumart folder if it does not exist", function() {
      assert(!fs.existsSync(albumartFolder));
      new AlbumArt(albumartFolder);
      assert(fs.existsSync(albumartFolder));
    });
  });
  describe("don't know yet", function() {
    it("something", function(done) {
      var db = leveldown(dbFolder);
      db.open(function(err) {
        if (err) {
          if (exitGracefullyIfRunning &&
            /^IO error: lock.*: Resource temporarily unavailable$/.test(err.message))
          {
            return;
          } else {
            throw err;
          }
        }
        loadConfig("config.json", function(err, config) {
          var player = new Player(db, config);
          player.initialize(function() {
            var args = {
              mtime: new Date().getTime(),
              relPath: "01 - Metal Invasion.mp3"
            };
            player.addToLibrary(args, function() {
              console.log(player.libraryIndex);
              done();
            });
          });
        });
      });
    });
  });
});
