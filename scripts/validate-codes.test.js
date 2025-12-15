const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

function validateCode(raw){
  const code = String(raw||'').trim();
  if (!code) return { ok:false, reason:'empty' };
  if (code.length < 3 || code.length > 8) return { ok:false, reason:'length' };
  if (/[^A-Za-z0-9]/.test(code)) return { ok:false, reason:'alnumOnly' };
  if (code !== code.toUpperCase()) return { ok:false, reason:'uppercase' };
  return { ok:true, reason:null };
}

function run(){
  const valids = ['ABCDEFG', 'GEMATMW', 'QWERTYU', 'CS101', 'MATH202', '101', 'A1B2C3'];
  valids.forEach(v => {
    const r = validateCode(v);
    assert(r.ok, `Expected valid code: ${v}`);
  });

  const invalids = [
    '', null, undefined, 'AB', 'ABCDEFGHI', // length out of range
    'abc101', 'Cs101', // not uppercase
    'CS_101', 'CS-101', 'CS 101', // special chars/spaces
    '🔥101' // non-alphanumeric
  ];
  invalids.forEach(v => {
    const r = validateCode(v);
    assert(!r.ok, `Expected invalid code: ${String(v)}`);
  });

  console.log('✅ validate-codes.test passed');
}

run();
