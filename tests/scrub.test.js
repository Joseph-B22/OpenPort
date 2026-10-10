// Part of OpenPort's logic tests. Run all with: npm test   (no model, no embedder, no real screen)
const ROOT = require('path').join(__dirname, '..').replace(/\\/g, '/');
const { scrub, luhn } = require(ROOT + '/scrub.js');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const s = t => scrub(t).text;

// secrets that must go
ok(!s('password: hunter2').includes('hunter2') && /password: \[REMOVED\]/.test(s('password: hunter2')), 'password: value');
ok(!s('api_key = "abc123XYZsecretvalue"').includes('abc123XYZ'), 'api_key = "quoted value"');
ok(!s('{"token":"s3cr3t-value-here"}').includes('s3cr3t'), 'JSON "token":"value"');
ok(!s('Authorization: Bearer abcdef0123456789abcdef0123456789').includes('abcdef0123'), 'Bearer token');
ok(!s('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c').includes('eyJhbGci'), 'JWT');
ok(!s('key AKIAIOSFODNN7EXAMPLE found').includes('AKIAIOSFODNN7EXAMPLE'), 'AWS access key');
ok(!s('export GH=ghp_abcdefghijklmnopqrstuvwxyz0123456789').includes('ghp_abcdef'), 'GitHub token');
ok(!s('-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7\nabcdefg\n-----END RSA PRIVATE KEY-----').includes('MIIEpA'), 'PEM private key block');
ok(!s('-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqh').includes('MIIEvQ'), 'truncated PEM block (cut off by the screen edge) is removed too');
ok(!s('enable secret 9 $9$abcdefghijkl$xyz').includes('abcdefghijkl') && s('enable secret 9 $9$abc$x').includes('enable secret [REMOVED]'), 'Cisco enable secret');
ok(!s('username admin password 0 admin123').includes('admin123'), 'Cisco username password');
ok(!s('snmp-server community s3cretComm RW').includes('s3cretComm'), 'SNMP community string');
ok(!s('Your verification code is 482913').includes('482913'), 'one-time code');
ok(!s('Visa 4111 1111 1111 1111 exp 12/29').includes('4111 1111'), 'credit card (passes Luhn)');
ok(!s('SSN 123-45-6789').includes('123-45-6789'), 'US SSN');
ok(!s('session ' + 'a1b2c3d4e5f6'.repeat(5)).includes('a1b2c3d4e5f6a1b2'), 'long random string');

// things that must stay: this is what the memory is FOR
const keep = 'ERROR storage disk quota exceeded for volume vol_finance on host fs-prod-3 at 10.9.8.7:443 version 17.6.3 order A-48213 VLAN 340';
ok(s(keep) === keep, 'IPs, host names, versions, order numbers and error text are untouched');
ok(s('ping 10.20.30.1 failed with code 1460 after 30 seconds') === 'ping 10.20.30.1 failed with code 1460 after 30 seconds', 'short numbers after the word "code" are not mistaken for one-time codes (needs 6-8 digits)');
ok(!luhn('1234567812345678') && s('order number 1234567812345678') === 'order number 1234567812345678', 'a long number that fails the card check is kept');
ok(s('C:\\Users\\admin\\Documents\\very-long-folder-name-with-many-words-in-it\\file.txt').includes('very-long-folder'), 'file paths are not treated as secrets');
ok(s('The quick brown fox jumps over the lazy dog every single morning without fail') === 'The quick brown fox jumps over the lazy dog every single morning without fail', 'ordinary prose is untouched');
ok(s('https://portal.corp.example/admin/settings') === 'https://portal.corp.example/admin/settings', 'ordinary URLs are untouched');

const r = scrub('password: a\ntoken=b\n4111111111111111');
ok(r.total === 3 && r.removed['key=value secret'] === 2 && r.removed['card number'] === 1, 'counts what was removed: ' + JSON.stringify(r.removed));
ok(scrub('').text === '' && scrub(null).text === '', 'empty input is fine');
