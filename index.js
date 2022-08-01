// https://datatracker.ietf.org/doc/html/rfc3492

// overflow calculation:
// https://datatracker.ietf.org/doc/html/rfc3492#section-6.4
// max unicode = 0x10FFFF => 21 bits
// max safe int = 53 bits (same as string length)
// (32 - 21) => 11-bit label length => 2KB unsigned
// (53 - 21) => 32-bit label length => 4GB unsigned
// decision: use IEEE-754 math, ignore bounds check

// Bootstring for Punycode
// https://datatracker.ietf.org/doc/html/rfc3492#section-5
const BASE = 36; 
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const BIAS = 72;
const MIN_CP = 128;
const MAX_CP = 0x10FFFF;
const SHIFT_BASE = BASE - T_MIN;
const MAX_DELTA = SHIFT_BASE * T_MAX >> 1;
const HYPHEN = 0x2D;

// 41..5A (A-Z) =  0 to 25, respectively
// 61..7A (a-z) =  0 to 25, respectively
// 30..39 (0-9) = 26 to 35, respectively

// An encoder SHOULD output only uppercase forms or only lowercase forms
// => lowercase
function cp_from_basic(x) {
	return x < 26 ? 97 + x : 22 + x;
}

// A decoder MUST recognize the letters in both uppercase and lowercase
// forms (including mixtures of both forms).
function basic_from_cp(cp) {
	if (cp >= 48 && cp <= 57) { // 0-9
		return cp - 22; 
	} else if (cp >= 97 && cp <= 122) { // a-z
		return cp - 97;
	} else if (cp >= 65 && cp <= 90) { // A-Z 
		return cp - 65;
	} else {		
		throw new Error(`not alphanumeric ASCII: 0x${cp.toString(16)}`);
	}
}

function trim_bias(k, bias) {
	let delta = k - bias;
	return delta <= 0 ? T_MIN : delta >= T_MAX ? T_MAX : delta;
}

// https://datatracker.ietf.org/doc/html/rfc3492#section-6.1
function adapt(delta, n, first) {
	delta = Math.floor(delta / (first ? DAMP : 2));
	delta += Math.floor(delta / n);
	let k = 0;
	while (delta > MAX_DELTA) {
		delta = Math.floor(delta / SHIFT_BASE);
		k += BASE;
	}
	return k + Math.floor((1 + SHIFT_BASE) * delta / (delta + SKEW));
}

// https://datatracker.ietf.org/doc/html/rfc3492#section-6.3
// cps -> cps
// does not restrict ascii [0, MIN_CP)
// does not append "xn--"
// returns unchanged if not required
export function puny_encode(cps) {
	if (!Array.isArray(cps) || !cps.every(cp => Number.isSafeInteger(cp) && cp >= 0 && cp <= MAX_CP)) {
		throw new TypeError(`expected array of Unicode codepoints`);
	}
	let ret = cps.filter(cp => cp < MIN_CP);
	let basic = ret.length;
	if (basic == cps.length) return cps; // puny not needed
	if (basic) ret.push(HYPHEN);
	let cp0 = MIN_CP;
	let bias = BIAS;
	let delta = 0;
	let pos = basic;
	while (pos < cps.length) {
		let cp1 = cps.reduce((min, cp) => cp >= cp0 && cp < min ? cp : min, MAX_CP);
		delta += (cp1 - cp0) * (pos + 1);
		for (let cp of cps) {
			if (cp < cp1) {
				delta++;
			} else if (cp == cp1) {
				let q = delta;
				for (let k = BASE; ; k += BASE) {
					let t = trim_bias(k, bias);
					let q_t = q - t;
					if (q_t < 0) break;
					let base_t = BASE - t;
					ret.push(cp_from_basic(t + (q_t % base_t)));
					q = Math.floor(q_t / base_t);
				}
				ret.push(cp_from_basic(q));
				bias = adapt(delta, pos + 1, pos == basic);
				delta = 0;
				pos++;
			}
		}
		delta++;
		cp0 = cp1 + 1;
	}
	return ret;
}

// https://datatracker.ietf.org/doc/html/rfc3492#section-6.2
// cps -> cps
// assumes "xn--" prefix is already removed
// does not restrict ascii part
export function puny_decode(cps) {
	if (!Array.isArray(cps) || !cps.every(cp => Number.isSafeInteger(cp) && cp >= 0 && cp <= MIN_CP)) {
		throw new TypeError(`expected array of ASCII codepoints`);
	}
	let pos = cps.lastIndexOf(HYPHEN) + 1; // start or past last hyphen
	let ret = cps.slice(0, Math.max(0, pos - 1)); // empty or before hyphen
	let i = 0, n = MIN_CP, bias = BIAS;
	while (pos < cps.length) {
		let prev = i;
		for (let w = 1, k = BASE; ; k += BASE) {
			if (pos >= cps.length) throw new Error(`invalid encoding`);
			let basic = basic_from_cp(cps[pos++]);
			i += basic * w;
			let t = trim_bias(k, bias);
			if (basic < t) break;
			w *= BASE - t;
		}
		let len = ret.length + 1;
		bias = adapt(i - prev, len, prev == 0);
		n += Math.floor(i / len);		
		if (n > MAX_CP) throw new Error(`invalid encoding`);
		i %= len;
		ret.splice(i++, 0, n);
	}	
	return ret;
}