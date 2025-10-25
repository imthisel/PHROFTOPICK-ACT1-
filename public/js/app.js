// public/js/app.js
// ==================== HEADER / APP LOGIC ====================

// ========== Helper: current school ==========
function currentSchool() {
  return localStorage.getItem('selectedSchool') || 'dlsu';
}

// ========== API ==========
const api = {
  searchSubjects: q =>
    fetch(`/api/subjects?school=${currentSchool()}` + (q ? '&q=' + encodeURIComponent(q) : '')).then(r => r.json()),
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(r => r.json()),
 
  getComments: profId => fetch(`/api/profs/${profId}?school=${currentSchool()}`).then(r => r.json()).then(data => data.comments || []),
  postComment: (profId, content, token, anonymous = false) => fetch(`/api/profs/${profId}/rate?school=${currentSchool()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
      'x-user-display': localStorage.getItem('user_display') || 'Anonymous'
    },
    body: JSON.stringify({ stars: 5, comment: content, anonymous })
  }).then(r => r.json())
};

// ========== Header initialization (separate function used elsewhere) ==========
async function initializeHeader() {
  const school = localStorage.getItem('selectedSchool') || 'dlsu';
  const avatarImg = document.getElementById('user-avatar');
  const drop = document.getElementById('user-dropdown');
  const dropDisplay = document.getElementById('drop-display');
  const btnLogout = document.getElementById('btn-logout');
  const btnShowLogin = document.getElementById('btn-show-login');

  const showLoggedOut = () => {
    if (btnShowLogin) btnShowLogin.style.display = 'inline-block';
    if (btnLogout) btnLogout.style.display = 'none';
    if (avatarImg) avatarImg.src = 'images/default-avatar.png';
  };

  const showLoggedIn = (displayName, photoUrl) => {
    if (btnShowLogin) btnShowLogin.style.display = 'none';
    if (btnLogout) btnLogout.style.display = 'inline-block';
    if (avatarImg) avatarImg.src = photoUrl || 'images/default-avatar.png';
    if (dropDisplay) dropDisplay.textContent = displayName || 'You';
  };

  // Dropdown toggle
  const userArea = document.getElementById('user-area');
  if (userArea && drop) {
    userArea.addEventListener('click', (e) => {
      e.stopPropagation();
      drop.style.display = drop.style.display === 'block' ? 'none' : 'block';
    });
    document.addEventListener('click', () => { drop.style.display = 'none'; });
  }

  const dropLogout = document.getElementById('drop-logout');
  if (dropLogout) {
    dropLogout.onclick = (e) => {
      e.preventDefault();
      localStorage.removeItem('token');
      localStorage.removeItem('user_display');
      showLoggedOut();
      alert('Signed out');
    };
  }

  // Load user info
  const token = localStorage.getItem('token');
  if (!token) return showLoggedOut();

  try {
    const resp = await fetch(`/api/me?school=${school}`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!resp.ok) return showLoggedOut();
    const json = await resp.json();
    const user = json.user || {};
    localStorage.setItem('user_display', user.display_name || 'You');
    showLoggedIn(user.display_name || 'You', user.photo_path);
  } catch (err) {
    console.error('Failed to load /api/me', err);
    showLoggedOut();
  }
}

// ========== Auth UI update ==========
function updateAuthUI() {
  const btnShowLogin = document.getElementById('btn-show-login');
  const btnLogout = document.getElementById('btn-logout');
  const userNameSpan = document.getElementById('user-name');

  if (!btnShowLogin || !btnLogout || !userNameSpan) {
    console.warn("updateAuthUI() called before header loaded");
    return;
  }

  const token = localStorage.getItem('token');
  if (token) {
    btnShowLogin.style.display = 'none';
    btnLogout.style.display = 'inline-block';
    userNameSpan.style.display = 'inline-block';
    userNameSpan.textContent = localStorage.getItem('user_display') || 'You';
  } else {
    btnShowLogin.style.display = 'inline-block';
    btnLogout.style.display = 'none';
    userNameSpan.style.display = 'none';
    userNameSpan.textContent = '';
  }
}

// ========== Rendering helpers ==========
function renderSubjects(list) {
  const subjectsList = document.getElementById('subjects-list') || null;
  if (!subjectsList) return;
  if (!list || list.length === 0) {
    subjectsList.innerHTML = '<div class="card">No subjects found</div>';
    return;
  }
  subjectsList.innerHTML = list.map(s => `
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
      if (!container) return;
      if (container.style.display === 'block') {
        container.style.display = 'none';
        b.textContent = 'View professors';
        return;
      }
      const res = await api.getProfsForSubject(id);
      renderProfList(res.professors || [], container);
      container.style.display = 'block';
      b.textContent = 'Hide professors';
    });
  });
}

async function renderProfList(list, container) {
  if (!container) return;
  if (!list || list.length === 0) {
    container.innerHTML = '<div class="card">No professors found</div>';
    return;
  }
  container.innerHTML = '';
  for (let p of list) {
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

    const form = document.getElementById(`comment-form-${p.id}`);
    if (form) {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const input = e.target.querySelector('input[type="text"]');
        const anonCheckbox = e.target.querySelector('input[type="checkbox"]');
        const content = input.value.trim();
        if (!content) return;
        const token = localStorage.getItem('token');
        const anonymous = anonCheckbox ? anonCheckbox.checked : false;
        const res = await api.postComment(p.id, content, token, anonymous);
        if (res.error) return alert(res.error);
        input.value = '';
        loadComments(p.id);
      });
    }
  }
}

async function loadComments(profId) {
  const container = document.getElementById(`comments-list-${profId}`);
  if (!container) return;
  const comments = await api.getComments(profId);
  container.innerHTML = comments.map(c => `
    <div class="comment-item">
      <strong>${c.display_name || 'Anonymous'}:</strong> ${c.comment}
      <span style="font-size:12px;color:#999;"> • ${new Date(c.created_at).toLocaleString()}</span>
    </div>
  `).join('');
}
window.initializeHeader = initializeHeader;

// ========== App-wide variables with safe initialization ==========
let subjectsVisible = false;
let profsVisible = false;
let lastProfQuery = '';

async function initializeHeaderSearch() {
  const profSearchInput = document.getElementById('prof-search');
  if (!profSearchInput) {
    console.warn('⚠ Header search not found yet, retrying...');
    setTimeout(initializeHeaderSearch, 300);
    return;
  }

    const subjectsList = document.getElementById('subjects-list') || null;
  const profListContainer = document.getElementById('prof-list') || null;


  profSearchInput.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = profSearchInput.value.trim();
      if (!q) return alert('Type something to search.');

      // Clear old results
      subjectsList.innerHTML = '';
      profListContainer.innerHTML = '';

      try {
        const [subRes, profRes] = await Promise.all([
          api.searchSubjects(q),
          api.searchProfs(q)
        ]);

        const subjects = subRes.subjects || [];
        const profs = profRes.professors || [];

        // Render results
        // Remove old section titles before rendering
document.querySelectorAll('.search-results-title').forEach(el => el.remove());

// Render results without adding new titles
if (subjects.length > 0) {
  renderSubjects(subjects);
}

if (profs.length > 0) {
  renderProfList(profs, profListContainer);
}

if (subjects.length === 0 && profs.length === 0) {
  subjectsList.innerHTML = '<div class="card">No results found.</div>';
}
      } catch (err) {
        console.error('Search failed:', err);
        subjectsList.innerHTML = '<div class="card">Error fetching results.</div>';
      }
    }
  });

  console.log('✅ Header search initialized (Enter key only)');
}

// ========= AUTOCOMPLETE SEARCH (for both header + index) =========
function enableAutocomplete(inputId, suggestionsId) {
  const attemptInit = () => {
    const input = document.getElementById(inputId);
    const suggestions = document.getElementById(suggestionsId);

    if (!input || !suggestions) {
      console.warn(`Waiting for ${inputId} to exist...`);
      return setTimeout(attemptInit, 300);
    }

    console.log(`✅ Autocomplete enabled for ${inputId}`);

    let debounceTimer;

    input.addEventListener("input", async () => {
      const q = input.value.trim();
      clearTimeout(debounceTimer);

      if (!q) {
        suggestions.style.display = "none";
        suggestions.innerHTML = "";
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          const [subRes, profRes] = await Promise.all([
            api.searchSubjects(q),
            api.searchProfs(q)
          ]);

          const subjects = subRes.subjects || [];
          const profs = profRes.professors || [];

          const combined = [
            ...profs.map(p => ({
              type: "Professor",
              label: p.name,
              id: p.id
            })),
            ...subjects.map(s => ({
              type: "Subject",
              label: `${s.code} — ${s.name}`,
              id: s.id
            }))
          ];

          if (combined.length === 0) {
            suggestions.style.display = "none";
            suggestions.innerHTML = "";
            return;
          }

          suggestions.innerHTML = combined
            .map(
              item => `
              <div class="suggestion-item" data-type="${item.type}" data-id="${item.id}">
                ${item.label}
              </div>`
            )
            .join("");

          suggestions.style.display = "block";

          // Click listener for results
          suggestions
            .querySelectorAll(".suggestion-item")
            .forEach(el =>
              el.addEventListener("click", e => {
                const type = e.currentTarget.dataset.type;
                const id = e.currentTarget.dataset.id;
                if (type === "Professor")
                  window.location.href = `/prof.html?id=${id}`;
                else window.location.href = `/subject.html?id=${id}`;
              })
            );
        } catch (err) {
          console.error("Autocomplete failed:", err);
        }
      }, 300);
    });

    // Hide suggestions when clicking elsewhere
    document.addEventListener("click", e => {
      if (!suggestions.contains(e.target) && e.target !== input) {
        suggestions.style.display = "none";
      }
    });
  };

  attemptInit();
}




// ========== DOM ready main initializer ==========
document.addEventListener('DOMContentLoaded', async () => {
  // --- Header setup (title, logo, change-school button) ---
 // ✅ Dynamic logo + fallback handling
// ✅ Dynamic logo + fallback handling

const school = localStorage.getItem('selectedSchool') || 'dlsu';
const headerTitle = document.getElementById('site-title');
const logoImg = document.querySelector('.school-logo');

if (headerTitle) {
  headerTitle.textContent = `${school.toUpperCase()} — PHROFS TO PICK`;
}

if (logoImg) {
  // Define proper image paths per school
  const logoMap = {
    dlsu: "images/dlsu-logo.png",
    ateneo: "images/ateneo-logo.png",
    benilde: "images/benilde-logo.png",
    up: "images/up-logo.png",
  };

  const fallbackLogo = "images/default-logo.png";
  const selectedLogo = logoMap[school] || fallbackLogo;

  logoImg.src = selectedLogo;
  logoImg.onerror = () => {
    console.warn(`⚠️ Missing logo for ${school}, using fallback.`);
    logoImg.src = fallbackLogo;
  };
}



  // Show Change School button (safe - only if header exists)
  const changeBtn = document.getElementById("change-school-btn");
  if (changeBtn) {
    // Make visible
    changeBtn.style.display = "inline-block";
    changeBtn.onclick = () => {
      localStorage.removeItem("selectedSchool");
      // optional: clear token/session if you want:
      // localStorage.removeItem('token');
      window.location.href = "school.html";
    };
  }

  // --- Grab elements safely (only if present on the page) ---
  const subjectSearch = document.getElementById('subject-search');
  const btnSearch = document.getElementById('btn-search');
  const btnListAll = document.getElementById('btn-list-all');
  const subjectsList = document.getElementById('subjects-list') || null;

  const profSearchInput = document.getElementById('prof-search');
  const btnProfSearch = document.getElementById('btn-prof-search');
  const profList = document.getElementById('prof-list');

  const modal = document.getElementById('modal');
  const modalContent = document.getElementById('modal-content');
  const modalClose = document.getElementById('modal-close');

  const uploadResult = document.getElementById('upload-result');

  // --- Modal handlers ---
  if (modal && modalContent) {
    window.showModal = function (html) {
      modalContent.innerHTML = html;
      modal.classList.remove('hidden');
    };
  }
  if (modalClose && modal) {
    modalClose.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
  }

  // --- Search handlers (safe attach if elements exist) ---
  if (subjectSearch && btnSearch) {
    subjectSearch.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        btnSearch.click();
      }
    });
    btnSearch.onclick = async () => {
      const q = subjectSearch.value.trim();
      const data = await api.searchSubjects(q);
      renderSubjects(data.subjects || []);
    };
  }

  if (btnListAll && subjectsList) {
    btnListAll.onclick = async () => {
      const subjectsContainer = subjectsList;
      if (!subjectsContainer) return;

      const FADE_MS = 300;
      if (subjectsVisible) {
        subjectsContainer.style.transition = `opacity ${FADE_MS}ms ease`;
        subjectsContainer.style.opacity = '0';
        setTimeout(() => {
          subjectsContainer.innerHTML = '';
          subjectsContainer.style.transition = '';
          subjectsContainer.style.opacity = '1';
        }, FADE_MS);
        btnListAll.textContent = 'List All';
        subjectsVisible = false;
        return;
      }

      // show
      const data = await api.listSubjects();
      renderSubjects(data.subjects || []);
      subjectsContainer.style.opacity = '0';
      // force reflow
      subjectsContainer.offsetHeight;
      subjectsContainer.style.transition = `opacity ${FADE_MS}ms ease`;
      subjectsContainer.style.opacity = '1';
      btnListAll.textContent = 'Hide All';
      subjectsVisible = true;
    };
  }

  // --- Professor search ---
  // --- Unified Search (Subjects + Professors) ---
if (profSearchInput && btnProfSearch) {
  profSearchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btnProfSearch.click();
    }
  });

  btnProfSearch.onclick = async () => {
    const q = profSearchInput.value.trim();
    if (!q) return alert('Type something to search.');

    const subjectsList = document.getElementById('subjects-list') || null;
    const profListContainer = document.getElementById('prof-list') || null;
    if (!subjectsList || !profListContainer) return;

    // Clear previous results
    subjectsList.innerHTML = '';
    profListContainer.innerHTML = '';

    try {
      // Fetch both in parallel
      const [subRes, profRes] = await Promise.all([
        api.searchSubjects(q),
        api.searchProfs(q)
      ]);

      const subjects = subRes.subjects || [];
      const profs = profRes.professors || [];

      // Render results
      if (subjects.length > 0) {
        const title = document.createElement('h2');
        title.textContent = 'Subjects';
        title.style.margin = '15px 0';
        subjectsList.before(title);
        renderSubjects(subjects);
      }

      if (profs.length > 0) {
        const title = document.createElement('h2');
        title.textContent = 'Professors';
        title.style.margin = '15px 0';
        profListContainer.before(title);
        renderProfList(profs, profListContainer);
      }

      if (subjects.length === 0 && profs.length === 0) {
        subjectsList.innerHTML = '<div class="card">No results found.</div>';
      }
    } catch (err) {
      console.error('Search failed:', err);
      subjectsList.innerHTML = '<div class="card">Error fetching results.</div>';
    }
  };
}

document.addEventListener('click', function(e) {
  const homeLink = e.target.closest('.home-link');
  if (homeLink) {
    e.preventDefault();
    if (window.location.pathname.includes('index.html')) {
      window.location.reload();
    } else {
      window.location.href = 'index.html';
    }
  }
});


  // --- Load subjects initially (if container exists) ---
if (subjectsList) {
  try {
    const d = await api.listSubjects();
    console.log("✅ API returned:", d);
    renderSubjects(d.subjects || []);
  } catch (err) {
    console.error('Failed to list subjects', err);
  }
}


  // --- Initialize header auth visuals if header is already in DOM ---
  if (typeof initializeHeader === 'function') initializeHeader();
  if (typeof updateAuthUI === 'function') updateAuthUI();
  // ✅ Ensure logo updates after header is loaded
if (typeof updateSchoolLogo === 'function') updateSchoolLogo();


  function initChangeSchoolButton() {
  const changeBtn = document.getElementById("change-school-btn");
  if (changeBtn) {
    changeBtn.style.display = "inline-block";
    changeBtn.onclick = () => {
      localStorage.removeItem("selectedSchool");
      window.location.href = "school.html";
    };
    console.log("✅ Change School button initialized");
  } else {
    console.warn("⚠️ Change School button not found yet");
  }
}


window.addEventListener("load", () => {
  // initialize both once header fully loaded
  enableAutocomplete("prof-search", "header-suggestions");
  enableAutocomplete("subject-search", "index-suggestions");
  initializeHeaderSearch(); // keep this intact
  
});

function updateSchoolLogo() {
  const school = localStorage.getItem("selectedSchool") || "dlsu";
  const logo = document.querySelector(".school-logo");
  const title = document.getElementById("site-title");

  const logoMap = {
    dlsu: "images/dlsu-logo.png",
    ateneo: "images/ateneo-logo.png",
    benilde: "images/benilde-logo.png",
    up: "images/up-logo.png",
  };
  const fallback = "images/default-logo.png";

  if (logo) {
    logo.src = logoMap[school] || fallback;
    logo.onerror = () => (logo.src = fallback);
  }
  if (title) title.textContent = `${school.toUpperCase()} — PHROFS TO PICK`;
}

window.updateSchoolLogo = updateSchoolLogo;
window.updateAuthUI = updateAuthUI;


});
