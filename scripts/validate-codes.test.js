const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

function validateCode(raw){
  const code = String(raw||'').trim();
  if (!code) return { ok:false, reason:'empty' };
  if (code.length !== 7) return { ok:false, reason:'length' };
  if (/[^A-Za-z]/.test(code)) return { ok:false, reason:'lettersOnly' };
  if (code !== code.toUpperCase()) return { ok:false, reason:'uppercase' };
  return { ok:true, reason:null };
}

function run(){
  const valids = ['ABCDEFG', 'GEMATMW', 'QWERTYU'];
  valids.forEach(v => {
    const r = validateCode(v);
    assert(r.ok, `Expected valid code: ${v}`);
  });

  const invalids = [
    '', null, undefined, 'ABC', 'ABCDEFGHI',
    'abcDEFG', 'ABCDEF1', 'ABC-DEF', 'AB CD EF', 'A B C D E F G'
  ];
  invalids.forEach(v => {
    const r = validateCode(v);
    assert(!r.ok, `Expected invalid code: ${String(v)}`);
  });

  console.log('✅ validate-codes.test passed');
}

run();
