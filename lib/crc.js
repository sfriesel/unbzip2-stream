module.exports = CRC;

var precomputed = new Int32Array(256);
var polynomial = 0x04C11DB7;
for (var i = 0; i < 256; ++i) {
    var c = i << 24;
    for (var j = 8; j > 0; --j) {
        var xor = c & 0x80000000 ? polynomial : 0;
        c <<= 1;
        c ^= xor;
    }
    precomputed[i] = c;
}

function CRC() {
    this._remainder = -1;
}
CRC.prototype.update = function CRC_update(data) {
    var r = this._remainder;
    for (var i = 0; i < data.length; ++i)
      r = (r << 8) ^ precomputed[(r >>> 24) ^ data[i]];
    this._remainder = r;
};
CRC.prototype.check_and_reset = function CRC_check_and_reset(expected) {
    var result = ~expected === this._remainder;
    this._remainder = -1;
    return result;
};
