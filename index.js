var Transform = require('stream').Transform;
var bz2 = require('./lib/bzip2');
var bitIterator = require('./lib/bit_iterator');

function Unbzip2Stream() {
    Transform.call(this);
    this.bufferQueue = [];
    this.hasBytes = 0;
    this.blockSize = 0;
    this.bitReader = null;
    this.streamCRC = null;
    this._finalizing = false;
}
Unbzip2Stream.prototype = Object.create(Transform.prototype);
Unbzip2Stream.prototype.constructor = Unbzip2Stream;

Unbzip2Stream.prototype.decompressBlock = function(push) {
    if (!this.blockSize) {
        this.blockSize = bz2.header(this.bitReader);
        this.streamCRC = 0;
        return true;
    } else {
        var bufsize = 100000 * this.blockSize;
        var buf = new Int32Array(bufsize);

        var chunk = [];
        var f = chunk.push.bind(chunk);

        this.streamCRC = bz2.decompress(this.bitReader, f, buf, bufsize, this.streamCRC);
        if (this.streamCRC === null) {
            // reset for next bzip2 header
            this.blockSize = 0;
            return false;
        } else {
            push(Buffer.from(chunk));
            return true;
        }
    }
};

Unbzip2Stream.prototype._decodeData = function(callback) {
    try {
        while (this.bitReader && this.hasBytes > this.bitReader.bytesRead) {
            if (!this._finalizing && this.hasBytes - this.bitReader.bytesRead + 1 < 25000 + 100000 * this.blockSize)
                break;
            this.decompressBlock(this.push.bind(this));
        }
    } catch(e) {
        callback(e);
        return false;
    }
    return true;
};

Unbzip2Stream.prototype._transform = function(data, encoding, callback) {
    this.bufferQueue.push(data);
    this.hasBytes += data.length;
    if (this.bitReader === null)
        this.bitReader = bitIterator(this.bufferQueue.shift.bind(this.bufferQueue));
    if (this._decodeData(callback))
        callback();
};
Unbzip2Stream.prototype._flush = function(callback) {
    this._finalizing = true;

    if (this._decodeData(callback)) {
        if (this.streamCRC !== null)
            callback(new Error("input stream ended prematurely"));
        else
            callback();
    }
};

module.exports = function unbzip2Stream() { return new Unbzip2Stream(); };
