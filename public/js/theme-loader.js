// public/js/theme-loader.js
const school = localStorage.getItem("selectedSchool") || "dlsu";
const link = document.createElement("link");
link.rel = "stylesheet";
link.href = `css/style-${school}.css`;
document.head.appendChild(link);
window.__SELECTED_SCHOOL = school;
