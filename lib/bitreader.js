module.exports = BitReader;

function BitReader() {
  this.chunks = [];
  this.currentChunk = Buffer.allocUnsafe(0);
  this.offset = 0;
  this.bufferedBits = 0;
  this.buffer = 0;
}
BitReader.prototype.push = function BitReader_push(chunk) {
  this.chunks.push(chunk);
};
BitReader.prototype.hasBits = function BitReader_hasBits(num) {
  var bufferedBits = this.bufferedBits;
  var tmp = this.currentChunk.length - this.offset;
  num -= tmp << 3;
  if (num <= bufferedBits)
    return true;
  for (var i = 0; i < this.chunks.length; ++i)
    num -= this.chunks[i].length << 3;
  return num <= bufferedBits;
};
BitReader.prototype.unshift = function BitReader_unshift(data, count) {
  this.buffer |= data << this.bufferedBits;
  this.bufferedBits += count;
  this.buffer &= (1 << this.bufferedBits) - 1;
};
BitReader.prototype.align = function BitReader_align() {
  this.bufferedBits &= -8;  // round down to multiple of 8
  this.buffer &= (1 << this.bufferedBits) - 1;
};
BitReader.prototype.read = function BitReader_read(count) {
  while (this.bufferedBits < count) {
    if (this.offset === this.currentChunk.length) {
      this.currentChunk = this.chunks.shift();
      if (!this.currentChunk)
        throw Error('read past end');
      this.offset = 0;
      continue;
    }
    this.bufferedBits += 8;
    this.buffer = (this.buffer << 8) | this.currentChunk[this.offset++];
  }
  this.bufferedBits -= count;
  var result = this.buffer >>> this.bufferedBits;
  this.buffer &= (1 << this.bufferedBits) - 1;
  return result;
};
