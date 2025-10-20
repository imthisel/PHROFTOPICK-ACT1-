// public/js/theme-loader.js
const SELECTED_SCHOOL = localStorage.getItem("selectedSchool") || "dlsu";
const themeLink = document.createElement("link");
themeLink.rel = "stylesheet";
themeLink.href = `css/style-${SELECTED_SCHOOL}.css`;
document.head.appendChild(themeLink);
window.__SELECTED_SCHOOL = SELECTED_SCHOOL;
