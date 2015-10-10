var url = require('url');
var fs = require('fs');
var log = require('./log');
var http = require('http');
var mm = require('musicmetadata');

module.exports = AlbumArt;

function AlbumArt() {
  this.folder = "albumart";
}

AlbumArt.prototype.getAlbumArtFile = function(dbFile) {
  var artistName = dbFile.artistName;
  var albumName = dbFile.albumName;
  var albumArtFileName = encodeURIComponent(artistName + "_" + albumName);
  return this.folder + "/" + albumArtFileName;
}

/**
 * Writes out album art covers under the url /albumart/sha1OfCover.jpg.
 * 
 * @param app
 * @param hasPermRead
 */
AlbumArt.prototype.initializeAlbumArtFetcher = function(app, hasPermRead, lastFm, player) {
  var self = this;
  app.get('/albumart/:image', hasPermRead, function(req, resp, next) {
    var currentTrackKey = player.currentTrack.key;
    var dbFile = player.libraryIndex.trackTable[currentTrackKey];
    var file = player.musicDirectory + "/" + dbFile.file;
    log.debug(file);
    var albumArtFile = self.getAlbumArtFile(dbFile);
    
    fs.exists(albumArtFile, function(exists) {
      log.debug("album art file " + albumArtFile + " exists: " + exists);
      // if the album art already exists serve it to the client
      if(exists) {
        serveAlbumCover(albumArtFile, resp);
        return;
      }
      // check the music file for an embedded image
      fetchImageFromFile(albumArtFile, file, function(exists, err) {
        if(exists) {
          serveAlbumCover(albumArtFile, resp);
          return;
        }
        // no luck let's check the folder of the file for an image
        // at last ask last.fm for a cover file
        fetchImageFromLastFM(dbFile.artistName, dbFile.albumName, albumArtFile, lastFm, function(exists) {
          if(exists) {
            serveAlbumCover(albumArtFile, resp);
            return;
          }
          resp.end();
        });
      });
    });
  });
}

function fetchImageFromFile(albumArtFile, file, callback) {
  fs.exists(file, function(exists) {
    if(!exists) {
      log.debug("wait the music file " + file + " does not exist?!");
      return;
    }
    var parser = mm(fs.createReadStream(file), function(err, metadata) {
      log.debug(metadata);
      if(metadata.picture.length > 0) {
        var cover = metadata.picture[0];
        fs.writeFile(albumArtFile, cover.data, function(err) {
          log.debug(err);
          callback(true, err);
        });
      }
      else {
        callback(false, err);
      }
    });
  });
}

function fetchImageFromLastFM(artist, album, imagePath, lastFm, callback) {
  lastFm.request("album.getInfo", {
    artist: artist,
    album: album,
    handlers: {
      success: function(data) {
        var large = data.album.image[2];
        var largeUrl = large["#text"];
        log.debug("downloading cover file: " + largeUrl);
        if(largeUrl.length === 0) {
          callback(false);
          return;
        }
        var file = fs.createWriteStream(imagePath);
        http.get(largeUrl, function(response) {
          file.on("finish", function() {
            callback(true);
          });
          response.pipe(file);
        });
      },
      error: function(error) {
        log.debug("error getting cover from lastFm: " + error);
        callback(false);
      }
    }
  });
}

function serveAlbumCover(imagePath, resp) {
  fs.exists(imagePath, function(exists) {
    if(exists) {
      writeAlbumCoverToResponse(imagePath, resp);
    } else {
      resp.end();
    }
  });
}

function writeAlbumCoverToResponse(imagePath, resp) {
  var imageStats = fs.statSync(imagePath);
  log.debug("image size: " + imageStats.size);
  resp.writeHead(200, {
    'Content-Type': 'image/jpg',
    'Content-Length': imageStats.size
  });
  fs.createReadStream(imagePath).pipe(resp);
}

/**
* Tries do determine the album cover of the track. It takes the first
* jpg file that it finds inside the same folder as the track. Then
* the checksum of that jpg is calculated and used as the file name
* inside the albumart folder. That way the cover is only ever copied
* once.
* 
* @param fullPath full path of the audio file
* @returns {String} the file name of the album cover
*/
function getAlbumCover(fullPath, callback) {
 var albumArtDir = "albumart";
 var parser = mm(fs.createReadStream(fullPath), function(err, metadata)
 {
   log.debug(metadata);
   if(metadata.picture.length > 0)
   {
     var cover = metadata.picture[0];
     var albumFile = path.join(albumArtDir, "albumart.jpg");
     fs.writeFile(albumFile, cover.data, function(err)
     {
       log.debug(err);
     });
   }
 });
 var self = this;
 var dir = path.dirname(fullPath);
 var albumArt = null;
 // create the albumart directory if it does not exist
 fs.exists(albumArtDir, function(exists) {
   if(!exists) {
     fs.mkdirSync(albumArtDir);
   }
 });
 // look for the album cover inside the track folder
 fs.readdir(dir, function(err, files) {
   if(err) {
     throw err;
   }
   var albumArtFile = null;
   for(var index = 0; index < files.length; index++) {
     var file = files[index];
     if(path.extname(file) === ".jpg") {
       albumArtFile = path.join(dir, file);
       break;
     }
   }
   if(albumArtFile == null) {
     callback(null);
     return;
   }
   log.debug("album art file: " + albumArtFile);
   self.checksumOfFile(albumArtFile, function(err, checksum) {
     if(err) {
       log.warn(err);
       callback(null);
     }
     var checksumFileName = checksum + ".jpg";
     albumArt = checksumFileName;
     callback(albumArt);
     var checksumFile = path.join(albumArtDir, checksumFileName);
     // only copy the cover if it does not exist already
     fs.exists(checksumFile, function(exists) {
       if(!exists) {
         fs.createReadStream(albumArtFile).pipe(fs.createWriteStream(checksumFile));
       }
     });
   });
 });
};