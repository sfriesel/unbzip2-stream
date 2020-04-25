module.exports = MTFDecoder;

function MTFDecoder() {
  this._buf = new Uint8Array(4096);
  this._indexes = new Int32Array(16);
}
MTFDecoder.prototype._reset = function MTFDecoder_reset() {
  this.length = 0;
  var j = 0;
  for (var i = this._buf.length - 256; i < this._buf.length; i += 16)
    this._indexes[j++] = i;
}
MTFDecoder.prototype.readSymbolMap = function MTFDecoder_readSymbolMap(bitReader) {
  this._reset();
  var symMap_L1 = bitReader.read(16) << 16;
  for (var i = 0; i < 16; ++i) {
    if (symMap_L1 << i >= 0) continue;
    var symMap_L2 = bitReader.read(16) << 16;
    for (var j = 0; j < 16; ++j)
      if (symMap_L2 << j < 0) {
        var l = this.length++;
        this._buf[this._indexes[l >>> 4] + (l & 0xF)] = (i << 4) + j;
      }
  }
}
MTFDecoder.prototype.get = function MTFDecoder_get(byte) {
  var block = byte >>> 4;
  var blockStart = this._indexes[block];
  var i = blockStart + (byte & 0xF);
  var result = this._buf[i];
  while (--i >= blockStart)
    this._buf[i+1] = this._buf[i];
  while (--block >= 0) {
    this._buf[blockStart] = this._buf[this._indexes[block]+15]
    blockStart = --this._indexes[block];
  }
  this._buf[blockStart] = result;
  if (this._indexes[0] === 0) {
    var k = this._buf.length;
    for (block = 15; block >= 0; --block) {
      for (var j = 15; j >= 0; --j)
        this._buf[--k] = this._buf[this._indexes[block]+j];
      this._indexes[block] = k;
    }
  }
  return result;
}