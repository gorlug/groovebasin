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
var musicFolder = testRunFolder + "/music";
var mp3Title = "Brad_Sucks_-_07_-_Total_Breakdown.mp3";
var testFolder = "test";

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
      fs.mkdirSync(musicFolder);
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
  describe("image fetchers", function() {
    it("get the album art from a mp3 file", function(done) {
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
        loadConfig(testFolder + "/config.json", function(err, config) {
          var player = new Player(db, config);
          player.initialize(function() {
            fs.readFile(testFolder + "/" + mp3Title, function(err, data) {
              if(err) throw err;
              fs.writeFile(musicFolder + "/" + mp3Title, data, function() {
                var args = {
                  mtime: new Date().getTime(),
                  relPath: mp3Title
                };
                player.addToLibrary(args, function() {
                  
                  var art = new AlbumArt(albumartFolder);

                  var dbFile;
                  for(key in player.libraryIndex.trackTable) {
                    dbFile = player.libraryIndex.trackTable[key];
                    break;
                  }
                  var albumArtFile = art.getAlbumArtFile(dbFile);
                  var file = player.musicDirectory + "/" + dbFile.file;
                  var fetchers = art.loadImageFetchers(albumArtFile, file, dbFile);
                  var fetcher = fetchers[1];
                  fetcher.fetch(function(exists) {
                    assert(exists, "callback should get an exists == true");
                    assert(fs.existsSync(albumArtFile), 
                      "check that the album art file exists by file path");
                    var expectedSha1 = "9b269df3bdb6a48eea4dc8354d430c459222b24a";
                    var crypto = require('crypto');
                    fs.readFile(albumArtFile, function (err, data) {
                        if(err) throw err;
                        var calculatedSha1 = crypto
                          .createHash('sha1')
                          .update(data, 'utf8')
                          .digest('hex');
                        console.log(calculatedSha1);
                        assert.equal(calculatedSha1, expectedSha1, "make sure " +
                          "the album art file is the right one by comparing the sha1 checksums");
                        done();
                    });
                  });
                });
              });
            });
          })
        });
      });
    });
  });
});
