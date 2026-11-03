// Menu mobile : le bouton ouvre et ferme la liste des liens de navigation.
const toggle = document.querySelector(".nav__toggle");
const links = document.getElementById("nav-links");

function setOpen(open) {
  links.classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
}

toggle.addEventListener("click", () => setOpen(!links.classList.contains("is-open")));
// Un lien suivi (ancre de la page comprise) referme le menu.
links.addEventListener("click", (event) => {
  if (event.target.closest("a")) setOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setOpen(false);
});

// Sous-menu : la section en cours de lecture est mise en évidence.
const subLinks = [...document.querySelectorAll(".subnav a[href^='#']")];
const sections = subLinks.map((a) => document.querySelector(a.getAttribute("href"))).filter(Boolean);

function markCurrent() {
  // Dernière section dont le haut est passé sous les deux barres du menu.
  const limit = 140;
  let current = null;
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= limit) current = section;
  }
  for (const a of subLinks) {
    a.classList.toggle("is-active", current !== null && a.getAttribute("href") === `#${current.id}`);
  }
}

if (sections.length) {
  addEventListener("scroll", markCurrent, { passive: true });
  markCurrent();
}
