var url = require('url');
var fs = require('fs');
var log = require('./log');
var http = require('http');
var mm = require('musicmetadata');
var path = require('path');

module.exports = AlbumArt;

function AlbumArt() {
  this.folder = "albumart";
  var self = this;
  //create the albumart folder if it does not exist
  fs.exists(self.folder, function(exists) {
    if(!exists) {
      fs.mkdirSync(self.folder);
    }
  });
}

/**
 * Generates the path name to which the album art for the given dbFile
 * is saved. Uses the artist name and album to generate the name.
 * 
 * @param dbFile the database file with artist name and album
 * @returns {String} the path to the album art file
 */
AlbumArt.prototype.getAlbumArtFile = function(dbFile) {
  var artistName = dbFile.artistName;
  var albumName = dbFile.albumName;
  var albumArtFileName = encodeURIComponent(artistName + "_" + albumName);
  return this.folder + "/" + albumArtFileName;
}

AlbumArt.prototype.loadImageFetchers = function(albumArtFile, file, dbFile, lastFm) {
  var fetchers = [];
  // if the album art already exists serve it to the client
  fetchers.push(new ImageFromAlbumArtFetcher(albumArtFile));
  // check the music file for an embedded image
  fetchers.push(new ImageFromFileFetcher(albumArtFile, file));
  // no luck let's check the folder of the file for an image
  fetchers.push(new ImageFromFolderFetcher(albumArtFile, file));
  // at last ask last.fm for a cover file
  fetchers.push(new ImageFromLastFMFetcher(albumArtFile, file, lastFm, dbFile.artistName, dbFile.albumName));
  return fetchers;
}

/**
 * Iterates through an array of album art fetchers until one of those
 * reports that it has saved the album art. It is then served to the
 * client.
 */
AlbumArt.prototype.callFetcher = function(fetchers, index, resp) {
  var self = this;
  var fetcher = fetchers[index];
  fetcher.fetch(function(exists) {
    if(exists) {
      serveAlbumCover(fetcher.albumArtFile, resp);
      return;
    }
    // check the next fetcher
    index = index + 1;
    if(index < fetchers.length) {
      self.callFetcher(fetchers, index, resp);
    } else {
      resp.end();
    }
  });
}

/**
 * Writes out album art covers under the url /albumart.
 */
AlbumArt.prototype.initializeAlbumArtFetcher = function(app, hasPermRead, lastFm, player, config) {
  // set up the get request that returns whether to render album art or not
  app.get('/albumartrender', hasPermRead, function(req, resp, next) {
    resp.send(config.albumArt);
  });
  if(!config.albumArt) {
    return;
  }
  var self = this;
  app.get('/albumart', hasPermRead, function(req, resp, next) {
    var currentTrackKey = player.currentTrack.key;
    var dbFile = player.libraryIndex.trackTable[currentTrackKey];
    var file = player.musicDirectory + "/" + dbFile.file;
    var albumArtFile = self.getAlbumArtFile(dbFile);
    var fetchers = self.loadImageFetchers(albumArtFile, file, dbFile, lastFm);
    self.callFetcher(fetchers, 0, resp);
  });
}

/**
 * Base function for image fetchers.
 */
function ImageFetcher(albumArtFile, file) {
  this.albumArtFile = albumArtFile;
  this.file = file;
}

/**
 * This fetcher simply checks if the album art is already saved inside
 * the albumart folder.
 */
function ImageFromAlbumArtFetcher(albumArtFile) {
  this.albumArtFile = albumArtFile;
}

ImageFromAlbumArtFetcher.prototype.fetch = function(callback) {
  var self = this;
  fs.exists(this.albumArtFile, function(exists) {
    log.debug("album art file " + self.albumArtFile + " exists: " + exists);
    callback(exists);
  });
}

/**
 * This fetcher extracts the album art directly from the music file
 * if it has an embedded image.
 */
function ImageFromFileFetcher(albumArtFile, file) {
  ImageFetcher.apply(this, arguments);
}

ImageFromFileFetcher.prototype.fetch = function(callback) {
  var self = this;
  fs.exists(self.file, function(exists) {
    if(!exists) {
      log.debug("wait the music file " + self.file + " does not exist?!");
      return;
    }
    var parser = mm(fs.createReadStream(self.file), function(err, metadata) {
      log.debug(metadata);
      if(metadata.picture.length > 0) {
        var cover = metadata.picture[0];
        fs.writeFile(self.albumArtFile, cover.data, function(err) {
          log.debug(err);
          callback(true, err);
        });
      }
      else {
        log.debug(err);
        callback(false, err);
      }
    });
  });
}

/**
* Tries do determine the album cover of the track. It takes the first
* jpg file that it finds inside the same folder as the track. It then
* saves it as the albumArtFile.
*/
function ImageFromFolderFetcher(albumArtFile, file) {
  ImageFetcher.apply(this, arguments);
}

ImageFromFolderFetcher.prototype.fetch = function(callback) {
  var self = this;
  var dir = path.dirname(this.file);
  // look for the album cover inside the track folder
  fs.readdir(dir, function(err, files) {
    if(err) {
      throw err;
    }
    var folderImage = null;
    for(var index = 0; index < files.length; index++) {
      var file = files[index];
      if(path.extname(file) === ".jpg") {
        folderImage = path.join(dir, file);
        break;
      }
    }
    if(folderImage == null) {
      callback(false);
      return;
    }
    log.debug("folderImage: " + folderImage);
    var file = fs.createWriteStream(self.albumArtFile);
    file.on("finish", function() {
      callback(true);
    });
    fs.createReadStream(folderImage).pipe(file);
  });
}

/**
 * This fetcher asks last.fm for an url to the album art which is then
 * downloaded to the albumart folder.
 */
function ImageFromLastFMFetcher(albumArtFile, file, lastFm, artist, album) {
  ImageFetcher.apply(this, arguments);
  this.lastFm = lastFm;
  this.artist = artist;
  this.album = album;
}

ImageFromLastFMFetcher.prototype.fetch = function(callback) {
  var self = this;
  this.lastFm.request("album.getInfo", {
    artist: self.artist,
    album: self.album,
    handlers: {
      success: function(data) {
        var large = data.album.image[2];
        var largeUrl = large["#text"];
        log.debug("downloading cover file: " + largeUrl);
        if(largeUrl.length === 0) {
          callback(false);
          return;
        }
        var file = fs.createWriteStream(self.albumArtFile);
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

/**
 * Serves the given imagePath file to the client but first
 * checks whether the image actually exists.
 */
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