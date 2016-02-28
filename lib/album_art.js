var url = require('url');
var fs = require('fs');
var log = require('./log');
var http = require('http');
var mm = require('musicmetadata');
var path = require('path');

module.exports = AlbumArt;

function AlbumArt(albumartFolder) {
  if(!albumartFolder) {
    albumartFolder = "albumart";
  }
  this.folder = albumartFolder;
  var self = this;
  //create the albumart folder if it does not exist
  var exists = fs.existsSync(self.folder);
  if(!exists) {
    fs.mkdirSync(self.folder);
  }
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
  // well nothing found at all, let's just save an image informing the user about that
  fetchers.push(new NoImageFoundFetcher(albumArtFile));
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
 * If no album art can be found a simple image is saved that shows
 * "No album art found". This is to prevent loading the whole chain
 * of fetchers each time a song of that album is played.
 */
function NoImageFoundFetcher(albumArtFile) { 
  this.albumArtFile = albumArtFile;
}

NoImageFoundFetcher.prototype.fetch = function(callback) {
  var imageBuffer = new Buffer(
      "/9j/4AAQSkZJRgABAQEAlgCWAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCACWAJYDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD7LooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAz7zXNFstXs9HvNY0+21K+DGzs5blEmuAoy3loTufA5OAcVL/amm/2yNF/tG0/tM2/2oWfnL5/k7tvmbM7tm75d2MZ4r56/aa0HVNe+MvhT/hH3ZNe0zQb7VNJI73NvNBIqEdw4BQj/AG62fAXiaw8Z/tIaJ4p004ttS+GvnhCcmNjqChkPurBlPuDQB7vRXh/grVPiV8UtP1rxVoXjePwtpseo3Nno1jHpUNwsqQsUEtw8gLZZgcqhXAHU13HwJ8aXXxA+F2keJ9QtYrTUJhLDeQxZ2LNFI0b7c5+UlMgZOAcZNAHcUUV4/wDGfxdqOk+NdO0WP4i2XhSxlsWnaKx0ptT1a4l34GIfKkVIQAfnwSWBHuAD2CuM0X4oeCdY8ZnwdY6ndHXP32LabTLqEMIjiQq8kaowHqGIPbNc9+zh461XxpoXiCHWbwajcaJrUunx35sWs3u4QqOkjwMAY3wxBXA6DiqvjX/k6n4ef9gTVf8A2lQB6N4k8TaJ4cm0qHWb37K+r36adYjynfzbhwxVPlB25Cty2Bx1rYrxP9q06kP+FZ/2OIP7QPjiyW2M4JjWQxTBWcDBKgnJAIJAxkVah1jx34J+MnhXwz4k8WJ4o0bxXFdxxPJp0VrLY3EEYl4MQAZGGRhskHv6gHsVFecfDfxNrer/ABd+Jug6je+dp2iXWnx6dD5SL5Ky2u9xuADNlufmJx2wK891X4meNrT4FfEnxTDqgk1bQvGE+n6c5t4gEtkvYI1iI2YPyOy7iC3Oc5ANAH0TRXzN4t8V/GDRbn4iaWnjmzkk8IaZBra3X9jwhrjzIyxtdvRYgY5fm5flfm4Ofovw7ftqnh/TtTZAjXdrFOVHRS6BsfrQBeooooAKKKKACiiigDh9b8Iale/Gnw741intF0/TNKvLKaNnbzmeZoypUbcEDYc5IPTg1yXw5+EWreD/AI+6/wCMYL+wfwtfWE8NhZB38+1knninkXbt2iPzFlYYbjf0r2WigDxzQ/A3xN8CLrei+Ab/AMKz6DqN/PfWTasZ0n01pjudFWNWWZA2SuSp5wSa7n4S+C7X4ffD7SvCVpdSXgskYy3Mi4aeV3Z5HI5xlmYgZOBgZOK6qigArynXfBPjnTfjDqfjzwVc+G511nTYLK8g1gzK1uYidrxGMHcpB5Q7ckda9O0y/sdTsYr/AE29tr20mG6Ke3lWSNxnGVZSQfwqxQB5T8J/AnjTwLrXjOS41LSNattduW1SC6keSGc3rRoGR4whVIdwOCrMQMDBrB1jwr8cNR+Jeg+OHsfh1HcaPZ3NrHbjVbwpIJtuST9myCNv617pXF+Nfin4D8HazHouv675OpSRCYWlvaT3UojJwGZYUYqPc4oA574r+B/GvjrQPBTQ3+iaPruia7b6tdyI8s0CNEkgxGCgaQbmX5W2ZGeRS6b4L8c698UtC8ZePLnw7BbeG4LldLstHaaTzZp0EbyytKq4wgwFAOCc59fSNE1Oy1rSLTVtNlaazu4lmgdo2QsjDIJVgGH0IBq5QB5NceC/iFoHxU8T+K/BN54YnsfFC2rXkGr+er2ssEXlB4/LBEgK8lSV57iueHwY8VL8DfGngSTWdLu9U1zxE+qW95K7ojRtcwy5lwmVciNsqoYAkDOOa96ooA8h8Z/DDX9Z1b4o3drd6Ykfi3w/b6ZYCSRwY5Y45VYy4Q4XMgwV3HrxXpvhixm0vw1pemXDI01pZwwSMhJUsiBSRkA4yPStGigAorIj8TaJJ4xm8IJe51uGxXUJLbyn4t2coH342/eBGM59q16ACiiigAooooA8x+O3im/8PvoFra+NtL8J299PILmd7Nr3UJQqgqlrbhHD8n5mI+UYxnOKyPgB4/1fxF4x8W+FNS1ubxBb6OlpcWWp3OkNp1xKkytuSSFkT7rLwwUAg1r/ABH8E+K7r4naB8QvBs+hy3+m2M+nzWertKkTxSENvR41Yq4II6cg4yKq+A/AfjnQPjBqvjTVdV0XVLfxDYwx6oE8yF7WWEOI0t02sGjAKqS7hjy3U4oAwYta+Knij4x+PfAWheKbfRdN0S5tLgaq+nRXE1vFPbI6W0cZAVst5hLvuICgc549F1nSvFEHwsutOfxpcf29Dasza5DYQI7lWL8QkNGMqNnTvkYNVfBPg7U9E+LHxB8WXc9m9j4kfTms44nYyx/Z7byn8wFQBluRgtx1x0rtb+2S8sbi0kJCTxNGxHUBhg/zoA8P/ZM8P+KI/hb4M1mbx9qE+jGwLDRG0+1EQB3gL5oj83gkN97nGDxXu1eSfBzwt8VfA+k6N4PvbjwZeeG9L3Qi8ia5F7LDliv7srsV+R/ERXrdAEV5HLNZzQwXDW0rxsscyqGMbEYDAHIJB5weK+bPh94Q8bXPx8+KNtB8VNUtb+zj0hbi/XSLF5LtXt3ZQVaIqgTGPkAznJya+mK4TwZ4O1PRfi58QPF11PZvY+Ixpos443Yyp9mgaN/MBUAZLDGCeOuKAMn4s+JvE/hqz8F+DtB1KKbxJ4jvU046vd2ysI0jj3T3PlLhC+BkJwuW9BiqMWteNfA3xa8KeFvEfin/AISrR/FSXUUNxPYQ21xZ3MEYkH+pCqyOMjBXIPf16P4weB7/AMWw6Fqmg6jb6d4h8O6iuoabNcxl4HOCrwygc7HU4JHIwMVlaX4L8aa/8SdD8Z/EC40C3Tw7DcDS9O0d5ZUM06hHmlklVScIMKoXgnOfUAtfDfxNrer/ABd+Jug6je+dp2iXWnx6dD5SL5Ky2u9xuADNlufmJx2wK5XR/Hniy4+C/wAWvEMurbtT8P6rrlvpc/2eIeRHbqTCu3btbb6sCT3zWxceC/iFoHxU8T+K/BN54YnsfFC2rXkGr+er2ssEXlB4/LBEgK8lSV57iqXhn4UeJNK+DHxC8FXerafe6n4kvNUmtLwsyowuk2o0oCfK2eWChgOxNAHOeIvFHxX8OfCrQPivfeL7O4hlGny32gDS4hC0Fw0aYE3+s8394CSCFznCgYFdt8UvEXiq5+J3hj4ceEtYj0GXUrS51HUNT+ypcSxQRbVVI0kBTLM2CWBwBxR8Qvh1rfiH9nyy+HtldadHqkFtpsLSzSOICbaSFnwwQtgiNsfL3GcVa+KHgnxNqHjfw5488EXukw65o8U9pLbap5gtru2mxlS0YLIykZBAPJ56cgHIfD228QWX7WOuWfiLVYtWuIfBtusN6tuIGni+1MQXRflDgll+XAIUHAziveK8q8CeBfGll8aNT+IXinUtGnGo6FHYG2sTIBbSJNuCJvX5k2gHeSCWZvlAxXqtABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUAf//Z"
      , "base64");
  fs.writeFile(this.albumArtFile, imageBuffer, function(err) {
    if(err) {
      console.log(err)
      callback(false);
      return;
    }
    callback(true);
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
