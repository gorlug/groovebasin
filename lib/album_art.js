var url = require('url');
var fs = require('fs');
var log = require('./log');

module.exports = AlbumArt;

function AlbumArt() {
  
}

/**
 * Writes out album art covers under the url /albumart/sha1OfCover.jpg.
 * 
 * @param app
 * @param hasPermRead
 */
AlbumArt.prototype.initializeAlbumArtFetcher = function(app, hasPermRead, lastFm) {
  app.get('/albumart/:image', hasPermRead, function(req, resp, next) {
    var queryObject = url.parse(req.url,true).query;
    var image = req.params.image;
    var imagePath = "albumart/" + image;
    if(image === "undefined") {
      imagePath = "albumart/" + escape(queryObject.artist) + "_" + escape(queryObject.album);
      fs.exists(imagePath, function(exists) {
        log.debug("cover file " + imagePath + " exists: " + exists);
        if(!exists) {
          fetchImageFromLastFM(queryObject, imagePath, lastFm, resp);
        } else {
          serveAlbumCover(imagePath, resp);
        }
      });
    } else {
      serveAlbumCover(imagePath, resp);
    }
  });
}

function fetchImageFromLastFM(queryObject, imagePath, lastFm, resp) {
  lastFm.request("album.getInfo", {
    artist: queryObject.artist,
    album: queryObject.album,
    handlers: {
      success: function(data) {
        var large = data.album.image[2];
        var largeUrl = large["#text"];
        log.debug("downloading cover file: " + largeUrl);
        if(largeUrl.length === 0) {
          resp.end();
          return;
        }
        var file = fs.createWriteStream(imagePath);
        http.get(largeUrl, function(response) {
          file.on("finish", function() {
            writeAlbumCoverToResponse(imagePath, resp);
          });
          response.pipe(file);
        });
      },
      error: function(error) {
        log.debug("error getting cover from lastFm: " + error);
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