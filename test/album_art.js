var AlbumArt = require('../lib/album_art.js');
var fs = require('fs');
var assert = require('assert');

var testRunFolder = "run_tests";
var albumartFolder = testRunFolder + "/albumart";

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
});
