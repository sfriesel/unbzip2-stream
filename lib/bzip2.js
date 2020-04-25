var MTFDecoder = require('./mtf');
var CRC = require('./crc');

module.exports = Bzip2;

function Bzip2() {
  this._bwtBuffer = new Int32Array(900000);
  this._bwtBufferSize = 0;
  this._mtf = new MTFDecoder();
  this._symbolBitLengths = new Int8Array(258);
  this._histogram = new Int32Array(256);
  this._selectors = [];
  this._expectFileHeader = true;
  this._trees = [];
  for (var i = 0; i < 6; ++i)
    this._trees[i] = {
      fast: new Int16Array(1 << 12),
      slow: [],
    };

  this._remaining = 0;
  this._crc = new CRC();
  this._previous = -1;
  this._run = 0;
  this._repeat = 0;
  this._i = 0;
}

Bzip2.prototype.isValidEnd = function Bzip2_isValidEnd() {
  return this._expectFileHeader;
};

Bzip2.prototype._read = function Bzip2__read(bitReader) {
  if (this._expectFileHeader) {
    this._expectFileHeader = false;
    if (bitReader.read(16) !== 0x425a)
      throw new Error('not a bzip file');
    if (bitReader.read(8) !== 0x68)
      throw new Error('wrong file format version');
    var bufSize = bitReader.read(8) - 48;
    if (bufSize < 1 || bufSize > 9)
      throw new Error('invalid buffer size');
    this._bwtBufferSize = 1e5 * bufSize;
    this._streamCRC = 0;
  }
  var magic1 = bitReader.read(24);
  var magic2 = bitReader.read(24);
  var expectedCRC = bitReader.read(16) << 16 | bitReader.read(16);
  if (magic1 === 0x314159 && magic2 === 0x265359) {
    this._expectedBlockCRC = expectedCRC;
    this._streamCRC = (this._streamCRC << 1) | (this._streamCRC >>> 31);
    this._streamCRC ^= expectedCRC;
    this._readMetadata(bitReader);
    return this._readData(bitReader);
  }
  if (magic1 === 0x177245 && magic2 === 0x385090) {
    if (expectedCRC !== this._streamCRC)
      throw new Error('stream CRC mismatch');
    bitReader.align();
    this._expectFileHeader = true;
    return false;
  }
  throw new Error('invalid block header');
}

Bzip2.prototype._readMetadata = function Bzip2__readMetadata(bitReader) {
  if (bitReader.read(1))
    throw new Error('randomization is not supported');
  this._origPtr = bitReader.read(24);
  if (this._origPtr >= this._bwtBufferSize)
    throw new Error('initial position out of range');
  this._mtf.readSymbolMap(bitReader);
  if (this._mtf.length < 1)
    throw new Error('at least one symbol required');
  this._symCount = this._mtf.length + 2;
  this._treeCount = bitReader.read(3);
  if (this._treeCount < 2 || this._treeCount > 6)
    throw new Error('invalid number of huff trees');
  this._selectorCount = bitReader.read(15);
  var i, j;
  var lruTree = this._trees[0];
  var tmpTrees = this._trees.slice();
  for (i = 0; i < this._selectorCount; ++i) {
    j = 0;
    while (bitReader.read(1)) {
      if (++j >= this._treeCount)
        throw new Error('tree reference out of bounds');
      lruTree = tmpTrees[j];
      tmpTrees[j] = tmpTrees[0];
      tmpTrees[0] = lruTree;
    }
    this._selectors[i] = lruTree;
  }
  var maxBitLen = 20;
  for (var k = 0; k < this._treeCount; ++k) {
    var bitlen = bitReader.read(5);
    if (bitlen < 1 || bitlen > maxBitLen)
      throw new Error('invalid initial code length');
    var bitlens = this._symbolBitLengths;
    var len;
    for (i = 0; i < this._symCount; ++i) {
      for (j = 1; bitReader.read(1); ++j) {
        if (j === maxBitLen)
          throw new Error('unsupported delta definition');
        if (bitReader.read(1))
          --bitlen;
        else
          ++bitlen;
        if (bitlen < 1 || bitlen > maxBitLen)
          throw new Error('invalid code length');
      }
      bitlens[i] = bitlen;
    }
    // The fast path uses 12 bits as a lookup key into an array, instantly resolving any symbols of 12 or less bits in length. Assuming the encoder picks a good tree for the data, this covers 95% of symbol lookups in the worst case (code lengths 1, 2, 3, 4, 12, 253x13) and >99% in typical cases.
    // This avoids hard-to-predict jumps of a branching search.
    var buf = this._trees[k].fast;
    var idx = 0;
    for (len = 1; len <= 12; ++len) {
      for (i = 0; i < this._symCount; ++i) {
        if (bitlens[i] !== len) continue;
        var val = i | len << 9;
        var end = (1 << 12 - len) + idx;
        buf.fill(val, idx, end);
        idx = end;
      }
    }
    idx <<= 8;
    var slow = this._trees[k].slow;
    slow.length = 0;
    for (len = 13; len <= 20; ++len) {
      var trailing = 20 - len;
      for (i = 0; i < this._symCount; ++i) {
        if (bitlens[i] !== len) continue;

        var fastIndexPrefix = idx >> 8;
        buf[fastIndexPrefix] = 20 << 9;
        var data = idx >>> trailing;
        slow.push({'bitsLength': len, 'bits': data, 'symbol': i});
        idx = (data + 1) << trailing;
      }
    }
  }
}
Bzip2.prototype.fillbuffer = function Bzip2_fillbuffer(bitReader) {
  var byteCount = this._histogram;
  byteCount.fill(0);
  var runBuf = 0;
  var runLen = 0;
  var bwtPointer = 0;
  var eob = (this._symCount - 1)|0;
  var bits = 0;  // local buffer of bits read
  var bitsToRead = 12;  // how much to read to refill buffer to 12
  var selectorIdx = 0;
  var tree;
  do {
    if (selectorIdx >= this._selectorCount)
      throw new Error('selector index overflow');
    tree = this._selectors[selectorIdx];
    selectorIdx = 0 | selectorIdx+1;
    var fast = tree.fast;
    var selectorCountDown = 50;
    do {
      bits = bits<<bitsToRead & 0xfff;
      bits |= bitReader.read(bitsToRead);
      var symbol = fast[bits];
      var symbolLength = symbol >>> 9;
      if (symbolLength <= 12) {
        symbol &= 0x1ff;
        bitsToRead = symbolLength;
      }
      else {
        bits <<= 8;
        bits |= bitReader.read(8);
        var overRead = 0;
        for (var j = 0; j < tree.slow.length; j = 0 | j+1) {
          overRead = symbolLength - tree.slow[j].bitsLength;
          if (tree.slow[j].bits === bits >>> overRead) {
            symbol = tree.slow[j].symbol;
            break;
          }
        }
        bitsToRead = 0 | 12-overRead;
      }
      if (symbol < 2) {
        runBuf |= symbol << runLen;
        ++runLen;
        continue;
      }
      var byte;
      if (runLen) {
        var m = bwtPointer;
        var run = (1 << runLen | runBuf) - 1;
        bwtPointer += run;
        if (bwtPointer > this._bwtBufferSize)
          throw new Error('buffer overflow');
        byte = this._mtf.get(0);
        this._bwtBuffer.fill(byte, m, bwtPointer);
        byteCount[byte] += run;
        runLen = 0;
        runBuf = 0;
      }
      if (symbol === eob)
        break;
      byte = symbol - 1;
      if (bwtPointer >= this._bwtBufferSize)
        throw new Error('buffer overflow');
      if (byte >= this._mtf.length)
        throw new Error('stack overflow');
      var tmp = this._bwtBuffer[bwtPointer++] = this._mtf.get(byte);
      byteCount[tmp]++;
    } while (--selectorCountDown > 0);
  } while (symbol !== eob);
  bitReader.unshift(bits, 12 - bitsToRead);
  return bwtPointer;
}
function bwtDecode(byteCount, bwtBuffer, bwtPointer) {
  var sum = 0;
  var i;
  for (i = 0; i < 256; ++i) {
    var tmp = sum + byteCount[i];
    byteCount[i] = sum;
    sum = tmp;
  }
  for (i = 0; i < bwtPointer; ++i) {
    var v = bwtBuffer[i] & 0xff;
    var x = byteCount[v];
    bwtBuffer[x] |= i << 8;
    byteCount[v]++;
  }
}
Bzip2.prototype._readData = function Bzip2__readData(bitReader) {
  var bwtPointer = this.fillbuffer(bitReader);
  if (bwtPointer === 0) {
    this.checkBlockCRC();
    return false;
  }
  bwtDecode(this._histogram, this._bwtBuffer, bwtPointer);
  this._remaining = bwtPointer;
  this._previous = -1;
  this._run = 0;
  this._i = this._bwtBuffer[this._origPtr] >>> 8;
  return true;
};
Bzip2.prototype.checkBlockCRC = function Bzip2_checkBlockCRC() {
  var crcIsCorrect = this._crc.check_and_reset(this._expectedBlockCRC);
  if (!crcIsCorrect)
    throw new Error('block CRC mismatch');
};
Bzip2.prototype.fillBlock = function Bzip2_fillBlock(bitReader, threshold) {
  if (this.readable())
    return true;
  while (bitReader.hasBits(threshold))
    if (this._read(bitReader))
      return true;
  return false;
};

Bzip2.prototype.readable = function Bzip2_readable() {
  return this._remaining > 0 || this._repeat > 0;
};

Bzip2.prototype.produce = function Bzip2_produce(size) {
  var remaining = this._remaining;
  var outBuffer = new Uint8Array(size);
  var outIndex = 0;
  var bwtBuffer = this._bwtBuffer;
  var previous = this._previous;
  var run = this._run;
  var repeat = this._repeat;
  var i = this._i;
  do {
    if (repeat > 0) {
      outBuffer[outIndex++] = previous;
      repeat--;
      if (repeat == 0) {
        previous = -1;
        run = 0;
      }
      continue;
    }
    if (!remaining)
      break;
    --remaining;
    i = bwtBuffer[i];
    var current = i & 0xff;
    i >>>= 8;
    if (run === 4) {
      repeat = current;
      if (repeat == 0) {
        previous = -1;
        run = 0;
      }
    } else {
      outBuffer[outIndex++] = current;
      run = (previous === current) ? run+1 : 1;
      previous = current;
    }
  } while (outIndex < size);
  var buf = Buffer.from(outBuffer.buffer, 0, outIndex);
  this._crc.update(buf);
  this._remaining = remaining;
  this._previous = previous;
  this._run = run;
  this._repeat = repeat;
  this._i = i;
  if (!this.readable())
    this.checkBlockCRC();
  return buf;
};
