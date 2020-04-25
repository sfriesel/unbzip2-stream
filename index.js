var Duplex = require('stream').Duplex;

var BitReader = require('./lib/bitreader');
var Bzip2 = require('./lib/bzip2');

module.exports = function() { return new Unbzip2Stream(); };

function Unbzip2Stream() {
  Duplex.call(this, {'readableHighWaterMark': 0x100000});
  this._bitReader = new BitReader();
  this._bz2 = new Bzip2();
  this._pendingReadSize = 0;
  this._writecb = null;
  this._finalcb = null;
}
Unbzip2Stream.prototype = Object.create(Duplex.prototype);

Unbzip2Stream.prototype._write = function(chunk, encoding, callback) {
  this._bitReader.push(chunk);
  if (!this._bitReader.hasBits(925000*8))
    return callback();
  if (this._pendingReadSize > 0) {
    var self = this;
    process.nextTick(function() {self._read(self._pendingReadSize);})
  }
  this._writecb = callback;
};

Unbzip2Stream.prototype._final = function(callback) {
  this._finalcb = callback;
  if (this._pendingReadSize > 0) {
    var self = this;
    process.nextTick(function() {self._read(self._pendingReadSize);})
  }
};

Unbzip2Stream.prototype._read = function(size) {
  size = size || 0x100000;
  this._pendingReadSize = 0;
  try {
    var isReadable = this._bz2.fillBlock(this._bitReader, this._finalcb ? 1 : 925000*8);
    if (isReadable)
      this.push(this._bz2.produce(size));
    else if (this._finalcb) {
      if (!this._bz2.isValidEnd())
        throw new Error("input stream ended unexpectedly");
      this._finalcb();
      this.push(null);
    } else {
      this._pendingReadSize = size;
      if (this._writecb) {
        process.nextTick(this._writecb);
        this._writecb = null;
      }
    }
  }
  catch (e) {
    this.destroy(e);
  }
};
