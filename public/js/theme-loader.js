// public/js/theme-loader.js

document.addEventListener('DOMContentLoaded', () => {
  const school = localStorage.getItem('selectedSchool');
  const isSchoolSelectPage = window.location.pathname.includes('school.html');

  // ✅ 1. If we're on school.html → no theme, plain white
  if (isSchoolSelectPage) {
    document.body.classList.remove('dlsu', 'ateneo', 'benilde', 'up');
    document.body.style.background = 'white';
    return;
  }

  // ✅ 2. Otherwise, apply theme for the selected school (default = dlsu)
  const SELECTED_SCHOOL = school || 'dlsu';

  // ✅ Dynamically load the correct theme CSS file
  const themeLink = document.createElement('link');
  themeLink.rel = 'stylesheet';
  themeLink.href = `css/style-${SELECTED_SCHOOL}.css`;
  document.head.appendChild(themeLink);

  // ✅ Apply the corresponding body class for possible theme styles
  document.body.classList.add(SELECTED_SCHOOL);

  // ✅ (Optional) Make the selected school available globally
  window.__SELECTED_SCHOOL = SELECTED_SCHOOL;
});
