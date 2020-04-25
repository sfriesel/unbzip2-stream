var test = require('tape');
var BitReader = require('../lib/bitreader');

test('can read up to 24 bits', function(t) {
    t.plan(2);

    var bi = new BitReader();
    bi.push(Buffer.from([0xf0, 0x11, 0x24, 0xa9]));

    t.equal(bi.read(1), 0x1);
    t.equal(bi.read(24), 0xe02249);
});

test('should return the correct bit pattern across byte boundaries', function(t) {
    t.plan(4);

    var bi = new BitReader();
    bi.push(Buffer.from([0x0f,0x10,0x01,0x80]));

    t.equal(bi.read(16), 0x0f10);
    t.equal(bi.read(7), 0x0);
    t.equal(bi.read(2), 0x03);
    t.equal(bi.read(7), 0x0);
});

test('should correctly switch from one buffer to the next', function(t) {
    t.plan(3);

    var bi = new BitReader();
    bi.push(Buffer.from([0x01]));
    bi.push(Buffer.from([0x80]));

    t.equal(bi.read(7), 0x0);
    t.equal(bi.read(2), 0x03);
    t.equal(bi.read(7), 0x0);
});

test('throws an error when reading past beyond the buffer', function(t) {
    t.plan(1);

    var bi = new BitReader();
    bi.push(Buffer.from([0x01]));

    t.throws(function() { bi.read(9); }, "read past end");
});

test('aligns to the byte boundary', function(t) {
    t.plan(3);

    var bi = new BitReader();
    bi.push(Buffer.from([0x0f,0x10,0x01,0x80]));

    t.equal(bi.read(7), 0x7);
    bi.align();
    t.equal(bi.read(16), 0x1001);
    bi.align();
    t.equal(bi.read(4), 0x8);
});

test('puts back returned bytes', function(t) {
    t.plan(2);

    var bi = new BitReader();
    bi.push(Buffer.from([0x0f,0x10,0x01,0x80]));

    t.equal(bi.read(12), 0xf1);
    bi.unshift(0xf1, 8);
    t.equal(bi.read(24), 0xf10018);
});

test('counts available bits', function(t) {
    t.plan(2);

    var bi = new BitReader();
    bi.push(Buffer.from([0x01]));
    bi.push(Buffer.from([0x80]));

    bi.read(2);
    t.ok(bi.hasBits(14), 'true if enough available');
    t.notOk(bi.hasBits(15), 'false if not enough available');
});
