


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

// ---------- Login button handler (Google modal with outside click close) ----------
if (btnShowLogin) {
  btnShowLogin.style.cursor = 'pointer';
  btnShowLogin.addEventListener('click', () => {
    const school = localStorage.getItem('selectedSchool') || 'dlsu';

    // Remove any previous modal first
    const existingModal = document.getElementById('auth-modal');
    if (existingModal) existingModal.remove();

    // Insert modal directly into body (not inside #modal)
    const html = `
      <div class="auth-modal" id="auth-modal">
        <div class="auth-modal-content">
          <h2 class="auth-title">Welcome Back 👋</h2>
          <p class="auth-subtitle">Sign in with your Google account to continue.</p>
          <button id="oauth-google" class="auth-google-btn">
            <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" class="google-icon" />
            Continue with Google
          </button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);

    // Attach handlers
    const modal = document.getElementById('auth-modal');
    const content = modal.querySelector('.auth-modal-content');
    const g = document.getElementById('oauth-google');

    // Handle Google click
    if (g) {
      g.addEventListener('click', () => {
        window.location.href = `/auth/google?school=${school}`;
      });
    }

    // ✅ Close modal when clicking outside content
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    // ✅ Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal) modal.remove();
    });
  });
}
// ---------- end login handler ----------






    // add this near the top of initializeHeader (where avatarImg, drop, etc. are grabbed)
  const userInitial = document.getElementById('user-initial');

  // -------------------------
  // Replace showLoggedOut / showLoggedIn
  // -------------------------
  const showLoggedOut = () => {
    if (btnShowLogin) btnShowLogin.style.display = 'inline-block';
    if (btnLogout) btnLogout.style.display = 'none';

    // hide avatar and initial circle when logged out
    if (avatarImg) {
      avatarImg.style.display = 'none';
      avatarImg.src = '';
    }
    if (userInitial) {
      userInitial.style.display = 'none';
      userInitial.textContent = '';
    }
    if (dropDisplay) dropDisplay.textContent = 'You';
  };

  const showLoggedIn = (displayName, photoUrl) => {
    if (btnShowLogin) btnShowLogin.style.display = 'none';
    if (btnLogout) btnLogout.style.display = 'inline-block';

    // Prefer actual photo; fall back to initials if photoUrl absent
    if (avatarImg && photoUrl) {
      avatarImg.src = photoUrl;
      avatarImg.style.display = 'inline-block';
      if (userInitial) userInitial.style.display = 'none';
    } else {
      // No photo: hide image and show initials circle
      if (avatarImg) {
        avatarImg.style.display = 'none';
        avatarImg.src = '';
      }
      if (userInitial) {
        // create initials from displayName (e.g., "John Doe" -> "JD")
        let initials = 'U';
        if (displayName) {
          initials = displayName.split(' ')
                                 .filter(Boolean)
                                 .slice(0,2)
                                 .map(s => s[0].toUpperCase())
                                 .join('');
        }
        userInitial.textContent = initials || 'U';
        userInitial.style.display = 'inline-flex';
      }
    }

    if (dropDisplay) dropDisplay.textContent = displayName || 'You';
  };

  // -------------------------
  // Replace updateAuthUI
  // -------------------------
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

      // show avatar or initials depending on whether we have a photo stored.
      const photo = null; // we don't always have photo here; prefer initializeHeader to set final state
      const storedDisplay = localStorage.getItem('user_display') || 'You';
      // If you already stored a photo URL in localStorage, show it:
      const storedPhoto = localStorage.getItem('user_photo') || null;
      if (storedPhoto && avatarImg) {
        avatarImg.src = storedPhoto;
        avatarImg.style.display = 'inline-block';
        if (userInitial) userInitial.style.display = 'none';
      } else {
        // show initials
        if (avatarImg) { avatarImg.style.display = 'none'; avatarImg.src = ''; }
        if (userInitial) {
          const initials = (storedDisplay.split(' ').filter(Boolean).slice(0,2).map(s=>s[0].toUpperCase()).join('')) || 'U';
          userInitial.textContent = initials;
          userInitial.style.display = 'inline-flex';
        }
      }
    } else {
      // logged out — hide both avatar and initials
      btnShowLogin.style.display = 'inline-block';
      btnLogout.style.display = 'none';
      userNameSpan.style.display = 'none';
      userNameSpan.textContent = '';
      if (avatarImg) { avatarImg.style.display = 'none'; avatarImg.src = ''; }
      if (userInitial) { userInitial.style.display = 'none'; userInitial.textContent = ''; }
    }
  }



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
      // Update the header visuals
      showLoggedOut();
      // Update any other UI that depends on auth
      if (typeof updateAuthUI === 'function') updateAuthUI();
      // Optional: close dropdown if open
      if (drop) drop.style.display = 'none';
      // Provide user feedback
      alert('Signed out');
      // Optional: force refresh to clear pages that rely on auth
      // window.location.href = '/index.html';
    };
  }

  // ✔ Attach same handler to the main header logout button so clicking it works
  if (btnLogout) {
    btnLogout.onclick = (e) => {
      e.preventDefault();
      localStorage.removeItem('token');
      localStorage.removeItem('user_display');
      showLoggedOut();
      if (typeof updateAuthUI === 'function') updateAuthUI();
      if (drop) drop.style.display = 'none';
      alert('Signed out');
      // window.location.href = '/index.html';
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


// ========== Auth UI update (single canonical version) ==========
function updateAuthUI() {
  const btnShowLogin = document.getElementById('btn-show-login');
  const btnLogout = document.getElementById('btn-logout');
  const userNameSpan = document.getElementById('user-name');
  const avatarImg = document.getElementById('user-avatar');
  const userInitial = document.getElementById('user-initial');
  const dropDisplay = document.getElementById('drop-display');

  if (!btnShowLogin || !btnLogout || !userNameSpan) {
    console.warn("updateAuthUI() called before header loaded");
    return;
  }

  const token = localStorage.getItem('token');

  if (token) {
    // Logged-in state
    btnShowLogin.style.display = 'none';
    btnLogout.style.display = 'inline-block';
    userNameSpan.style.display = 'inline-block';
    const storedDisplay = localStorage.getItem('user_display') || 'You';
    userNameSpan.textContent = storedDisplay;
    if (dropDisplay) dropDisplay.textContent = storedDisplay;

    // Prefer stored photo if present
    const storedPhoto = localStorage.getItem('user_photo') || null;
    if (storedPhoto && avatarImg) {
      avatarImg.src = storedPhoto;
      avatarImg.style.display = 'inline-block';
      if (userInitial) userInitial.style.display = 'none';
    } else {
      // Show initials fallback
      if (avatarImg) { avatarImg.style.display = 'none'; avatarImg.src = ''; }
      if (userInitial) {
        const initials = (storedDisplay.split(' ').filter(Boolean).slice(0,2).map(s => s[0].toUpperCase()).join('')) || 'U';
        userInitial.textContent = initials;
        userInitial.style.display = 'inline-flex';
      }
    }
  } else {
    // Logged-out state — hide everything that could show a user marker
    btnShowLogin.style.display = 'inline-block';
    btnLogout.style.display = 'none';
    userNameSpan.style.display = 'none';
    userNameSpan.textContent = '';
    if (dropDisplay) dropDisplay.textContent = 'You';
    if (avatarImg) { avatarImg.style.display = 'none'; avatarImg.src = ''; }
    if (userInitial) { userInitial.style.display = 'none'; userInitial.textContent = ''; }
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


// ========= LIVE SEARCH + AUTOCOMPLETE (FINAL FIX) =========

// Main header search (Enter key version)
async function initializeHeaderSearch() {
  const profSearchInput = document.getElementById('prof-search');
  if (!profSearchInput) {
    console.warn('⚠ Header search input not found, retrying...');
    return setTimeout(initializeHeaderSearch, 300);
  }

  const subjectsList = document.getElementById('subjects-list');
  const profListContainer = document.getElementById('prof-list');

  profSearchInput.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = profSearchInput.value.trim();
      if (!q) return alert('Type something to search.');

      subjectsList.innerHTML = '';
      profListContainer.innerHTML = '';

      try {
        const [subRes, profRes] = await Promise.all([
          api.searchSubjects(q),
          api.searchProfs(q)
        ]);

        // Handle both array and object responses safely
        const subjects = Array.isArray(subRes)
          ? subRes
          : (subRes.subjects || []);
        const profs = Array.isArray(profRes)
          ? profRes
          : (profRes.professors || []);

        if (subjects.length > 0) renderSubjects(subjects);
        if (profs.length > 0) renderProfList(profs, profListContainer);
        if (subjects.length === 0 && profs.length === 0) {
          subjectsList.innerHTML = '<div class="card">No results found.</div>';
        }
      } catch (err) {
        console.error('Search failed:', err);
        subjectsList.innerHTML = '<div class="card">Error fetching results.</div>';
      }
    }
  });

  console.log('✅ Header search initialized');
}



// ========= Autocomplete / Live Suggestions (FINAL FIX) =========
function enableAutocomplete(inputId, suggestionsId) {
  const tryInit = () => {
    const input = document.getElementById(inputId);
    const suggestions = document.getElementById(suggestionsId);
    if (!input || !suggestions) {
      console.warn(`Waiting for ${inputId} and ${suggestionsId}...`);
      return setTimeout(tryInit, 300);
    }

    console.log(`✅ Live autocomplete active for #${inputId}`);
    let debounceTimer;

    input.addEventListener('input', async () => {
      const q = input.value.trim();
      clearTimeout(debounceTimer);

      if (!q) {
        suggestions.innerHTML = '';
        suggestions.style.display = 'none';
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          const [subRes, profRes] = await Promise.all([
            api.searchSubjects(q),
            api.searchProfs(q)
          ]);

          const subjects = Array.isArray(subRes)
            ? subRes
            : (subRes.subjects || []);
          const profs = Array.isArray(profRes)
            ? profRes
            : (profRes.professors || []);

          const combined = [
            ...profs.map(p => ({
              type: 'Professor',
              label: p.name,
              id: p.id
            })),
            ...subjects.map(s => ({
              type: 'Subject',
              label: `${s.code} — ${s.name}`,
              id: s.id
            }))
          ];

          if (combined.length === 0) {
            suggestions.innerHTML = '';
            suggestions.style.display = 'none';
            return;
          }

          // Render live suggestions
          suggestions.innerHTML = combined.map(
            item => `
              <div class="suggestion-item" data-type="${item.type}" data-id="${item.id}">
                ${item.label}
              </div>
            `
          ).join('');
          suggestions.style.display = 'block';

          // Click → redirect
          suggestions.querySelectorAll('.suggestion-item').forEach(el =>
            el.addEventListener('click', e => {
              const type = e.currentTarget.dataset.type;
              const id = e.currentTarget.dataset.id;
              if (type === 'Professor')
                window.location.href = `/prof.html?id=${id}`;
              else
                window.location.href = `/subject.html?id=${id}`;
            })
          );
        } catch (err) {
          console.error('Autocomplete failed:', err);
        }
      }, 300);
    });

    // Hide suggestions when clicking elsewhere
    document.addEventListener('click', e => {
      if (!suggestions.contains(e.target) && e.target !== input) {
        suggestions.style.display = 'none';
      }
    });
  };

  tryInit();
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


// --- Robust logo setup (replace existing logo initialization block) ---
// ...existing code...

if (logoImg) {
  const logoMap = {
    dlsu: "/images/dlsu-logo.png",
    ateneo: "/images/ateneo-logo.png",
    benilde: "/images/benilde-logo.png",
    up: "/images/up-logo.png",
  };
  const fallbackLogo = "/images/default-logo.png";
  const selectedLogo = logoMap[school] || fallbackLogo;

  // Reset class and handlers
  logoImg.classList.remove('loaded');

  logoImg.onload = () => {
    // mark as loaded so CSS can fade/show it
    logoImg.classList.add('loaded');
    // clear any temporary inline fallback styling
    logoImg.style.background = '';
    logoImg.style.padding = '';
    logoImg.style.borderRadius = '';
    logoImg.style.objectFit = 'contain';
  };

  // Robust onerror -> set inline SVG fallback (prevents broken image icon)
  logoImg.onerror = () => {
    try {
      // avoid loop if we already replaced src with a data URL
      if (!logoImg.src || logoImg.src.startsWith('data:image/svg+xml')) {
        // if already data URL, just ensure it's revealed
        logoImg.classList.add('loaded');
        return;
      }
      // Prefer real fallback file first; if that fails, use SVG data URL
      if (logoImg.src !== fallbackLogo) {
        logoImg.src = fallbackLogo;
        return;
      }
      // As last resort use inline SVG so UI always looks intentional
      logoImg.src = generateLogoDataUrl(school);
      // Add subtle inline styling for consistent appearance
      logoImg.style.background = 'transparent';
      logoImg.style.padding = '6px';
      logoImg.style.borderRadius = '6px';
      logoImg.style.objectFit = 'contain';
      logoImg.classList.add('loaded');
    } catch (err) {
      console.warn('Logo fallback failed', err);
      logoImg.classList.add('loaded');
    }
  };

  // Use preloaded global if present, otherwise selectedLogo
  logoImg.src = window.__PRELOADED_LOGO || selectedLogo;
  try { logoImg.decoding = 'async'; } catch (e) {}
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


// ...existing code...

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
    const selected = logoMap[school] || fallback;
    const targetSrc = window.__PRELOADED_LOGO || selected;

    // Clear previous handlers
    logo.onload = null;
    logo.onerror = null;

    logo.onload = () => {
      logo.classList.add('loaded');
      logo.style.background = '';
      logo.style.padding = '';
      logo.style.borderRadius = '';
      logo.style.objectFit = 'contain';
      logo.onerror = null;
    };

    logo.onerror = () => {
      try {
        if (!logo.src || logo.src.startsWith('data:image/svg+xml')) {
          logo.classList.add('loaded');
          return;
        }
        if (logo.src !== fallback) {
          logo.src = fallback;
          return;
        }
        // last-resort inline SVG fallback
        logo.src = generateLogoDataUrl(school);
        logo.style.padding = '6px';
        logo.style.borderRadius = '6px';
        logo.classList.add('loaded');
      } catch (e) {
        logo.classList.add('loaded');
        console.warn('updateSchoolLogo fallback error', e);
      }
    };

    logo.classList.remove('loaded');
    logo.src = targetSrc;
  }

  if (title) title.textContent = `${school.toUpperCase()} — PHROFS TO PICK`;
}

// ...existing code...

function generateLogoDataUrl(school) {
  const code = (school || 'dlsu').toLowerCase();
  const initialsMap = { dlsu: 'DL', ateneo: 'AT', benilde: 'BD', up: 'UP' };
  const colorMap = { dlsu: '#074E6A', ateneo: '#0B3D91', benilde: '#7B1FA2', up: '#006400' };
  const initials = initialsMap[code] || code.slice(0, 2).toUpperCase();
  const bg = colorMap[code] || '#666';
  const fg = '#fff';
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40">
      <rect width="100%" height="100%" rx="6" fill="${bg}"/>
      <text x="50%" y="50%" fill="${fg}" font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif"
            font-size="18" font-weight="600" dominant-baseline="middle" text-anchor="middle">${initials}</text>
    </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

window.updateSchoolLogo = updateSchoolLogo;
window.updateAuthUI = updateAuthUI;




});


