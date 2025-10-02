// app.js - frontend interactions for index.html
const api = {
  searchSubjects: q => fetch('/api/subjects' + (q ? '?q=' + encodeURIComponent(q) : '')).then(r => r.json()),
  listSubjects: () => fetch('/api/subjects').then(r => r.json()),
  getProfsForSubject: id => fetch('/api/subjects/' + id + '/profs').then(r => r.json()),
  searchProfs: q => fetch('/api/profs/search?q=' + encodeURIComponent(q)).then(r => r.json()),
  uploadNote: (formData, token) => fetch('/api/upload', { method: 'POST', headers: token ? { 'Authorization': 'Bearer ' + token } : {}, body: formData }).then(r => r.json()),
  login: (body) => fetch('/api/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(r => r.json()),
  signup: (body) => fetch('/api/auth/signup', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(r => r.json())
};

// element refs
const subjectSearch = document.getElementById('subject-search');
const btnSearch = document.getElementById('btn-search');
const btnListAll = document.getElementById('btn-list-all');
const subjectsList = document.getElementById('subjects-list');

const profSearchInput = document.getElementById('prof-search');
const btnProfSearch = document.getElementById('btn-prof-search');
const profList = document.getElementById('prof-list');

const modal = document.getElementById('modal');
const modalContent = document.getElementById('modal-content');
const modalClose = document.getElementById('modal-close');

const btnShowLogin = document.getElementById('btn-show-login');
const btnShowSignup = document.getElementById('btn-show-signup');
const btnLogout = document.getElementById('btn-logout');
const userNameSpan = document.getElementById('user-name');

const uploadForm = document.getElementById('upload-form');
const uploadResult = document.getElementById('upload-result');

function showModal(html) {
  modalContent.innerHTML = html;
  modal.classList.remove('hidden');
}
modalClose.addEventListener('click', ()=> modal.classList.add('hidden'));
modal.addEventListener('click', (e)=> { if (e.target === modal) modal.classList.add('hidden'); });

// auth UI
function updateAuthUI() {
  const token = localStorage.getItem('token');
  if (token) {
    btnShowLogin.style.display = 'none';
    btnShowSignup.style.display = 'none';
    btnLogout.style.display = 'inline-block';
    userNameSpan.style.display = 'inline-block';
    const name = localStorage.getItem('user_display') || 'You';
    userNameSpan.textContent = name;
  } else {
    btnShowLogin.style.display = 'inline-block';
    btnShowSignup.style.display = 'inline-block';
    btnLogout.style.display = 'none';
    userNameSpan.style.display = 'none';
    userNameSpan.textContent = '';
  }
}
updateAuthUI();

btnShowLogin.onclick = () => {
  showModal(`
    <h3>Login</h3>
    <form id="login-form">
      <input name="school_id_or_email" placeholder="School ID or school email" required />
      <input name="password" placeholder="Password" type="password" required />
      <button>Login</button>
    </form>
    <p style="font-size:12px;color:#9aa;">You may sign up if you don't have an account.</p>
  `);
  setTimeout(() => {
    const f = document.getElementById('login-form');
    f.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const fd = new FormData(f);
      const body = { school_id_or_email: fd.get('school_id_or_email'), password: fd.get('password') };
      const res = await api.login(body);
      if (res.error) return alert(res.error);
      localStorage.setItem('token', res.token);
      localStorage.setItem('user_display', res.user.display_name || res.user.school_id_or_email);
      updateAuthUI();
      modal.classList.add('hidden');
      alert('Logged in');
    });
  }, 30);
};

btnShowSignup.onclick = () => {
  showModal(`
    <h3>Sign up</h3>
    <form id="signup-form">
      <input name="school_id_or_email" placeholder="School ID or school email" required />
      <input name="password" placeholder="Password" type="password" required />
      <input name="display_name" placeholder="Display name (optional)" />
      <label><input type="checkbox" name="anonymous" /> Join as anonymous</label>
      <button>Sign up</button>
    </form>
    <p style="font-size:12px;color:#9aa;">Your email/id will be used for login only.</p>
  `);
  setTimeout(() => {
    const f = document.getElementById('signup-form');
    f.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const fd = new FormData(f);
      const body = {
        school_id_or_email: fd.get('school_id_or_email'),
        password: fd.get('password'),
        display_name: fd.get('display_name'),
        anonymous: !!fd.get('anonymous')
      };
      const res = await api.signup(body);
      if (res.error) return alert(res.error);
      localStorage.setItem('token', res.token);
      localStorage.setItem('user_display', res.user.display_name || res.user.school_id_or_email);
      updateAuthUI();
      modal.classList.add('hidden');
      alert('Account created & logged in');
    });
  }, 30);
};

btnLogout.onclick = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user_display');
  updateAuthUI();
  alert('Logged out');
};

/* Subjects search */
btnSearch.onclick = async () => {
  const q = subjectSearch.value.trim();
  const data = await api.searchSubjects(q);
  renderSubjects(data.subjects || []);
};

btnListAll.onclick = async () => {
  const data = await api.listSubjects();
  renderSubjects(data.subjects || []);
};

function renderSubjects(list) {
  if (!list || list.length === 0) {
    subjectsList.innerHTML = '<div class="card">No subjects found</div>';
    return;
  }
  subjectsList.innerHTML = list.map(s => `
    <div class="card">
      <h3>${s.code || '—'} — ${s.name}</h3>
      <p>Difficulty (avg): ${s.difficulty_avg ? Number(s.difficulty_avg).toFixed(2) : 'N/A'}</p>
      <button data-subid="${s.id}" class="btn-view-profs">View professors</button>
    </div>
  `).join('');

  document.querySelectorAll('.btn-view-profs').forEach(b => {
    b.addEventListener('click', async (ev) => {
      const id = ev.currentTarget.dataset.subid;
      const res = await api.getProfsForSubject(id);
      renderProfList(res.professors || []);
    });
  });
}

/* Global prof search */
btnProfSearch.onclick = async () => {
  const q = profSearchInput.value.trim();
  if (!q) return alert('Type a query');
  const res = await api.searchProfs(q);
  renderProfList(res.professors || []);
};

function renderProfList(list) {
  if (!list || list.length === 0) {
    profList.innerHTML = '<div class="card">No professors found</div>';
    return;
  }
  profList.innerHTML = list.map(p => `
    <div class="card">
      <h3>${p.name}</h3>
      <p>${p.subject_code || ''} - ${p.subject_name || ''}</p>
      <p>Rating: ${p.rating_avg ? Number(p.rating_avg).toFixed(2) : 'N/A'}</p>
      <a href="/prof.html?id=${p.id}"><button>Open profile</button></a>
    </div>
  `).join('');
}

/* Upload notes */
uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('upload-file');
  if (!fileInput.files.length) return alert('Select a file');
  const fd = new FormData();
  fd.append('note', fileInput.files[0]);
  fd.append('prof_id', document.getElementById('upload-prof-id').value || '');
  fd.append('subject_id', document.getElementById('upload-subject-id').value || '');
  fd.append('description', document.getElementById('upload-desc').value || '');
  const token = localStorage.getItem('token');
  const res = await api.uploadNote(fd, token);
  if (res.error) uploadResult.innerText = 'Upload failed: ' + res.error;
  else uploadResult.innerHTML = `Uploaded. <a href="${res.path}" target="_blank">Open file</a>`;
});

/* initial load */
(async function() {
  // list top subjects by default
  const d = await api.listSubjects();
  renderSubjects(d.subjects || []);
})();
