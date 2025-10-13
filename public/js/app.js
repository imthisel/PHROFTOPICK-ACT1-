// ==================== SCHOOL THEME LOADING ====================
// Use the same school value loaded by theme-loader.js
const school = window.__SELECTED_SCHOOL || localStorage.getItem('selectedSchool') || 'dlsu';

// Dynamically load the school's CSS theme
const themeLink = document.createElement("link");
themeLink.rel = "stylesheet";
themeLink.href = `css/style-${school}.css`;
document.head.appendChild(themeLink);

// ==================== HEADER SETUP ====================
document.addEventListener("DOMContentLoaded", () => {
  const headerTitle = document.getElementById("site-title");
  const logoImg = document.querySelector(".school-logo");

  // ✅ Always show SCHOOL — PHROFSTOPICK
  if (headerTitle) {
    headerTitle.textContent = `${school.toUpperCase()} — PHROFSTOPICK`;
  }

  // ✅ Update logo image without deleting the title
  if (logoImg) {
    logoImg.src = `images/${school}-logo.png`;
    logoImg.onerror = () => { logoImg.src = `images/${school}-logo.jpeg`; };
  }
});




// ==================== API FUNCTIONS ====================

// ==================== API FUNCTIONS (fixed for live switching) ====================
function currentSchool() {
  return localStorage.getItem('selectedSchool') || 'dlsu';
}

const api = {
  searchSubjects: q => fetch(`/api/subjects?school=${currentSchool()}` + (q ? '&q=' + encodeURIComponent(q) : '')).then(r => r.json()),
  listSubjects: () => fetch(`/api/subjects?school=${currentSchool()}`).then(r => r.json()),
  getProfsForSubject: id => fetch(`/api/subjects/${id}/profs?school=${currentSchool()}`).then(r => r.json()),
  searchProfs: q => fetch(`/api/profs/search?school=${currentSchool()}&q=${encodeURIComponent(q)}`).then(r => r.json()),
  uploadNote: (formData, token) => fetch(`/api/upload?school=${currentSchool()}`, { 
      method: 'POST', 
      headers: token ? { 'Authorization': 'Bearer ' + token } : {}, 
      body: formData 
  }).then(r => r.json()),
  login: body => fetch(`/api/auth/login?school=${currentSchool()}`, { 
      method: 'POST', 
      headers: {'Content-Type':'application/json'}, 
      body: JSON.stringify(body) 
  }).then(r => r.json()),
  signup: body => fetch(`/api/auth/signup?school=${currentSchool()}`, { 
      method: 'POST', 
      headers: {'Content-Type':'application/json'}, 
      body: JSON.stringify(body) 
  }).then(r => r.json()),
  getComments: profId => fetch(`/api/profs/${profId}?school=${currentSchool()}`).then(r => r.json()).then(data => data.comments || []),
  postComment: (profId, content, token, anonymous=false) => fetch(`/api/profs/${profId}/rate?school=${currentSchool()}`, {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
        'x-user-display': localStorage.getItem('user_display') || 'Anonymous'
      },
      body: JSON.stringify({ stars: 5, comment: content, anonymous })
  }).then(r => r.json())
};



// Element references
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

// ==================== ENTER KEY SEARCH TRIGGERS ====================

// When user presses Enter inside the Subject search input
subjectSearch.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault(); // prevent form submission or page reload
    btnSearch.click();  // trigger the "Search" button click
  }
});

// When user presses Enter inside the Professor search input
profSearchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    btnProfSearch.click(); // trigger the "Find Professors" button click
  }
});


// Modal
function showModal(html) {
  modalContent.innerHTML = html;
  modal.classList.remove('hidden');
}
modalClose.addEventListener('click', ()=> modal.classList.add('hidden'));
modal.addEventListener('click', e => { if(e.target === modal) modal.classList.add('hidden'); });

// ======= AUTH SYSTEM (restored from old version) =======

// Auth UI
function updateAuthUI() {
  const token = localStorage.getItem('token');
  if (token) {
    btnShowLogin.style.display = 'none';
    btnShowSignup.style.display = 'none';
    btnLogout.style.display = 'inline-block';
    userNameSpan.style.display = 'inline-block';
    userNameSpan.textContent = localStorage.getItem('user_display') || 'You';
  } else {
    btnShowLogin.style.display = 'inline-block';
    btnShowSignup.style.display = 'inline-block';
    btnLogout.style.display = 'none';
    userNameSpan.style.display = 'none';
    userNameSpan.textContent = '';
  }
}
updateAuthUI();

// Login Modal
btnShowLogin.onclick = () => {
  showModal(`
    <div class="auth-modal">
      <h2>Welcome back 👋</h2>
      <p class="auth-sub">Sign in to continue</p>
      <form id="login-form" class="auth-form">
        <label>
          <span>School ID or Email</span>
          <input name="school_id_or_email" type="text" required />
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" required />
        </label>
        <button class="auth-btn">Login</button>
        <p class="auth-footer">Don’t have an account?
          <a href="#" id="link-to-signup">Sign up here</a>
        </p>
      </form>
    </div>
  `);

  setTimeout(() => {
    const f = document.getElementById('login-form');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(f);
      const body = {
        school_id_or_email: fd.get('school_id_or_email'),
        password: fd.get('password')
      };
      const res = await api.login(body);
      if (res.error) return alert(res.error);
      localStorage.setItem('token', res.token);
      localStorage.setItem('user_display', res.user.display_name || res.user.school_id_or_email);
      updateAuthUI();
      modal.classList.add('hidden');
      alert('Logged in');
    });

    document.getElementById('link-to-signup').onclick = (e) => {
      e.preventDefault();
      btnShowSignup.click();
    };
  }, 30);
};

// Signup Modal
btnShowSignup.onclick = () => {
  showModal(`
    <div class="auth-modal">
      <h2>Create Account 🪪</h2>
      <p class="auth-sub">Join and start rating professors!</p>
      <form id="signup-form" class="auth-form">
        <label>
          <span>School ID or Email</span>
          <input name="school_id_or_email" type="text" required />
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" required />
        </label>
        <label>
          <span>Display Name (optional)</span>
          <input name="display_name" type="text" />
        </label>
        <label class="check-line">
          <input type="checkbox" name="anonymous" />
          <span>Join as anonymous</span>
        </label>
        <button class="auth-btn">Sign up</button>
        <p class="auth-footer">Already have an account?
          <a href="#" id="link-to-login">Login here</a>
        </p>
      </form>
    </div>
  `);

  setTimeout(() => {
    const f = document.getElementById('signup-form');
    f.addEventListener('submit', async e => {
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

    document.getElementById('link-to-login').onclick = (e) => {
      e.preventDefault();
      btnShowLogin.click();
    };
  }, 30);
};

// Logout
btnLogout.onclick = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user_display');
  updateAuthUI();
  alert('Logged out');
};


// Subjects
btnSearch.onclick = async () => {
  const q = subjectSearch.value.trim();
  const data = await api.searchSubjects(q);
  renderSubjects(data.subjects || []);
};
// Put this near your other button handlers in app.js
let subjectsVisible = false; // toggle state

btnListAll.onclick = async () => {
  const subjectsContainer = document.getElementById('subjects-list');
  if (!subjectsContainer) return;

  const FADE_MS = 300;

  // If visible -> fade out, then clear
  if (subjectsVisible) {
    // ensure transition is set
    subjectsContainer.style.transition = `opacity ${FADE_MS}ms ease`;
    // start fade-out
    subjectsContainer.style.opacity = '0';

    // after fade completes, clear HTML and reset opacity for next show
    setTimeout(() => {
      subjectsContainer.innerHTML = '';
      // reset inline styles so next render starts from full opacity
      subjectsContainer.style.transition = '';
      subjectsContainer.style.opacity = '1';
    }, FADE_MS);

    btnListAll.textContent = 'List All';
    subjectsVisible = false;
    return;
  }

  // Otherwise fetch and render, with a small fade-in
  const data = await api.listSubjects();
  renderSubjects(data.subjects || []);

  // start from invisible -> then fade in so transition is smooth
  subjectsContainer.style.opacity = '0';
  // force reflow so browser notices the change
  // eslint-disable-next-line no-unused-expressions
  subjectsContainer.offsetHeight;
  subjectsContainer.style.transition = `opacity ${FADE_MS}ms ease`;
  subjectsContainer.style.opacity = '1';

  btnListAll.textContent = 'Hide All';
  subjectsVisible = true;
};





function renderSubjects(list){
  if(!list || list.length===0){
    subjectsList.innerHTML='<div class="card">No subjects found</div>';
    return;
  }
  subjectsList.innerHTML = list.map(s=>`
    <div class="card">
      <h3>${s.code || '—'} — ${s.name}</h3>
      <p>Difficulty (avg): ${s.difficulty_avg ? Number(s.difficulty_avg).toFixed(2) : 'N/A'}</p>
      <button data-subid="${s.id}" class="btn-view-profs">View professors</button>
      <a href="/subject.html?id=${s.id}"><button>Open Subject Page</button></a>

      <div class="prof-sublist" id="prof-sublist-${s.id}"></div>
    </div>
  `).join('');

  document.querySelectorAll('.btn-view-profs').forEach(b => {
  b.addEventListener('click', async ev => {
    const id = ev.currentTarget.dataset.subid;
    const container = document.getElementById(`prof-sublist-${id}`);

    // ✅ Toggle visibility
    if (container.style.display === 'block') {
      container.style.display = 'none';
      b.textContent = 'View professors';
      return;
    }

    // Otherwise, show professors
    const res = await api.getProfsForSubject(id);
    renderProfList(res.professors || [], container);
    container.style.display = 'block';
    b.textContent = 'Hide professors';
  });
 });

}

// Global professor search
let profsVisible = false; // track toggle state
let lastProfQuery = '';   // track last search query

btnProfSearch.onclick = async () => {
  const q = profSearchInput.value.trim();
  const profListContainer = document.getElementById('prof-list');

  // ✅ If professors are visible and the same query -> hide them
  if (profsVisible && q === lastProfQuery) {
  profListContainer.classList.add('fade-out');
  setTimeout(() => {
    profListContainer.innerHTML = '';
    profListContainer.classList.remove('fade-out');
  }, 300);
  btnProfSearch.textContent = 'Find Professors';
  profsVisible = false;
  return;
}


  // ✅ Otherwise fetch and show professors
  if (!q) return alert('Type a query');
  
  const res = await api.searchProfs(q);
  renderProfList(res.professors || [], profListContainer);

  btnProfSearch.textContent = 'Hide Professors';
  profsVisible = true;
  lastProfQuery = q;
};



// Render professors
async function renderProfList(list, container){
  if(!list || list.length===0){
    container.innerHTML='<div class="card">No professors found</div>';
    return;
  }

  container.innerHTML='';
  for(let p of list){
    const card = document.createElement('div');
    card.classList.add('card');
    card.innerHTML = `
      ${p.photo_path ? `<img src="${p.photo_path}" class="prof-photo" alt="${p.name}">` : ''}
      <h3>${p.name}</h3>
      <p><strong>Department:</strong> N/A</p>
      <p><strong>Courses:</strong> ${p.subject_code ? p.subject_code + ' - ' + p.subject_name : 'N/A'}</p>
      <a href="/prof.html?id=${p.id}"><button>Open profile</button></a>
      <div class="panel" id="comments-panel-${p.id}">
        <h4>Comments</h4>
        <form id="comment-form-${p.id}">
  <input type="text" placeholder="Write a comment..." required />
  <label style="font-size:13px;">
    <input type="checkbox" /> Comment anonymously
  </label>
  <button type="submit">Post</button>
</form>

        <div id="comments-list-${p.id}"></div>
      </div>
    `;
    container.appendChild(card);

    loadComments(p.id);

    document.getElementById(`comment-form-${p.id}`).addEventListener('submit', async e=>{
  e.preventDefault();
  const input = e.target.querySelector('input');
  const anonCheckbox = e.target.querySelector('input[type="checkbox"]');
  const content = input.value.trim();
  if(!content) return;
  const token = localStorage.getItem('token');
  const anonymous = anonCheckbox ? anonCheckbox.checked : false;
  const res = await api.postComment(p.id, content, token, anonymous);
  if(res.error) return alert(res.error);
  input.value='';
  loadComments(p.id);
   });

  }
}

// Load comments
async function loadComments(profId){
  const container = document.getElementById(`comments-list-${profId}`);
  if(!container) return;
  const comments = await api.getComments(profId);
  container.innerHTML = comments.map(c=>`
    <div class="comment-item">
      <strong>${c.display_name || 'Anonymous'}:</strong> ${c.comment}
      <span style="font-size:12px;color:#999;"> • ${new Date(c.created_at).toLocaleString()}</span>
    </div>
  `).join('');
}

// Upload notes
uploadForm.addEventListener('submit', async e => {
  e.preventDefault();
  const fileInput = document.getElementById('upload-file');
  if(!fileInput.files.length) return alert('Select a file');
  const fd = new FormData();
  fd.append('note', fileInput.files[0]);
  fd.append('prof_id', document.getElementById('upload-prof-id').value || '');
  fd.append('subject_id', document.getElementById('upload-subject-id').value || '');
  fd.append('description', document.getElementById('upload-desc').value || '');
  const token = localStorage.getItem('token');
  const res = await api.uploadNote(fd, token);
  if(res.error) uploadResult.innerText='Upload failed: '+res.error;
  else uploadResult.innerHTML=`Uploaded. <a href="${res.path}" target="_blank">Open file</a>`;
});

// Initial load — show subjects right away after selecting school
document.addEventListener('DOMContentLoaded', async () => {
  const d = await api.listSubjects();
  renderSubjects(d.subjects || []);
});

