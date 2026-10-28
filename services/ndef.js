'use strict';
// NDEF encoder — builds the NFC Forum Type 2 TLV that a phone reads from an
// NTAG (user memory from page 4): 0x03 <len> <NDEF message> 0xFE.
//
// One record per message. Up to 254 bytes it is a short record behind a 1-byte
// TLV length; longer (a NTAG215 / 216 has 496 / 872 bytes) takes the 4-byte
// record length and the 3-byte TLV length. Supported content:
//   { type: 'url',   url }
//   { type: 'wifi',  ssid, password, auth: 'wpa2' | 'wpa' | 'open' }
//   { type: 'contact', name, phone, email, org, url }   — vCard 3.0
//   { type: 'email', to, subject, body }                 — mailto: URI
//   { type: 'phone', number }                            — tel: URI
//   { type: 'sms',   number, body }                      — sms: URI
//
// References: NFC Forum NDEF 1.0 + URI RTD (prefix table), Wi-Fi Alliance
// "Wi-Fi Simple Configuration" credential (MIME application/vnd.wfa.wsc).

const USER_BYTES = 144; // pages 0x04-0x27, the TigerTag region (a NTAG213's whole NDEF room)

// URI RTD abbreviations — the longest matching prefix is replaced by its code.
const URI_PREFIXES = [
  [0x02, 'https://www.'], [0x01, 'http://www.'], [0x04, 'https://'], [0x03, 'http://'],
  [0x05, 'tel:'], [0x06, 'mailto:'],
];

function _uriPayload(uri) {
  for (const [code, prefix] of URI_PREFIXES) {
    if (uri.toLowerCase().startsWith(prefix)) return Buffer.concat([Buffer.from([code]), Buffer.from(uri.slice(prefix.length), 'utf8')]);
  }
  return Buffer.concat([Buffer.from([0x00]), Buffer.from(uri, 'utf8')]);
}

// One record, alone in its message: MB | ME | (SR when it fits) | TNF.
function _record(tnf, type, payload) {
  const typeBuf = Buffer.from(type, 'ascii');
  if (payload.length <= 255) return Buffer.concat([Buffer.from([0xD0 | tnf, typeBuf.length, payload.length]), typeBuf, payload]);
  const len = Buffer.alloc(4); len.writeUInt32BE(payload.length, 0);
  return Buffer.concat([Buffer.from([0xC0 | tnf, typeBuf.length]), len, typeBuf, payload]);
}
// Type 2 TLV around the message: 1-byte length up to 254, else 0xFF + 2 bytes.
function _tlv(msg) {
  const len = msg.length <= 254 ? Buffer.from([msg.length]) : Buffer.from([0xFF, msg.length >> 8, msg.length & 0xFF]);
  return Buffer.concat([Buffer.from([0x03]), len, msg, Buffer.from([0xFE])]);
}

// Wi-Fi Simple Configuration attribute: 2-byte id, 2-byte length, value.
function _wsc(id, value) {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(id, 0);
  head.writeUInt16BE(value.length, 2);
  return Buffer.concat([head, value]);
}
const _u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n, 0); return b; };

function _wifiPayload({ ssid = '', password = '', auth = 'wpa2' }) {
  const open = auth === 'open';
  const authType = open ? 0x0001 : auth === 'wpa' ? 0x0002 : 0x0020; // Open / WPA-PSK / WPA2-PSK
  const encType  = open ? 0x0001 : 0x0008;                            // None / AES
  const cred = Buffer.concat([
    _wsc(0x1026, Buffer.from([0x01])),                // Network Index
    _wsc(0x1045, Buffer.from(ssid, 'utf8')),          // SSID
    _wsc(0x1003, _u16(authType)),                     // Authentication Type
    _wsc(0x100F, _u16(encType)),                      // Encryption Type
    _wsc(0x1027, Buffer.from(open ? '' : password, 'utf8')), // Network Key
    _wsc(0x1020, Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF])), // MAC: any
  ]);
  return _wsc(0x100E, cred);                          // Credential
}

// vCard text: CRLF line ends, commas / semicolons / backslashes escaped.
const _vEsc = s => String(s || '').replace(/([\\,;])/g, '\\$1').replace(/\r?\n/g, '\\n');
function _vcard({ name = '', phone = '', email = '', org = '', url = '' }) {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${_vEsc(name)}`];
  if (phone) lines.push(`TEL:${_vEsc(phone)}`);
  if (email) lines.push(`EMAIL:${_vEsc(email)}`);
  if (org)   lines.push(`ORG:${_vEsc(org)}`);
  if (url)   lines.push(`URL:${_vEsc(url)}`);
  lines.push('END:VCARD');
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

const _query = params => {
  const q = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return q ? `?${q}` : '';
};

/** The NDEF message (one record) for a content object. */
function ndefMessage(m = {}) {
  switch (m.type) {
    case 'url':     return _record(0x01, 'U', _uriPayload(String(m.url || '').trim()));
    case 'phone':   return _record(0x01, 'U', _uriPayload(`tel:${String(m.number || '').replace(/\s+/g, '')}`));
    case 'email':   return _record(0x01, 'U', _uriPayload(`mailto:${String(m.to || '').trim()}${_query({ subject: m.subject, body: m.body })}`));
    case 'sms':     return _record(0x01, 'U', _uriPayload(`sms:${String(m.number || '').replace(/\s+/g, '')}${_query({ body: m.body })}`));
    case 'wifi':    return _record(0x02, 'application/vnd.wfa.wsc', _wifiPayload(m));
    case 'contact': return _record(0x02, 'text/vcard', _vcard(m));
    default:        throw new Error('ndef-unknown-type');
  }
}

/** The user-memory image for a chip with `capacity` bytes of NDEF room: TLV +
 *  terminator, zero-padded to the 144-byte TigerTag region (so nothing of a
 *  TigerTag stays), or to whole pages when longer. Throws 'ndef-too-long'
 *  (err.size = bytes needed) when it does not fit. */
function ndefImage(m, capacity = USER_BYTES) {
  const tlv = _tlv(ndefMessage(m));
  if (tlv.length > capacity) {
    const err = new Error('ndef-too-long');
    err.size = tlv.length;
    throw err;
  }
  const len = Math.max(USER_BYTES, Math.ceil(tlv.length / 4) * 4);
  return Buffer.concat([tlv, Buffer.alloc(len - tlv.length)]);
}

/** Bytes the content takes on the chip. */
function ndefSize(m) {
  try { return { ok: true, size: _tlv(ndefMessage(m)).length }; }
  catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { ndefImage, ndefSize, USER_BYTES };
